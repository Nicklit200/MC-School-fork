package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.notifications.PushSubscription;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Private owner-only server workflow. Never prepares a future date, never
 * overwrites existing lesson materials, and does not use ChatGPT/MCH3 tools.
 * Both PDFs are rendered and validated by the existing Mindcrafti A4 renderer.
 */
@Service
public class OwnerSameDayWorkbookService {
    private static final Logger LOG = LoggerFactory.getLogger(OwnerSameDayWorkbookService.class);
    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
    private static final LocalTime START_AT = LocalTime.of(9, 0);
    private static final UUID OWNER = AiLessonPilotService.PILOT_TEACHER_ID;

    private final JdbcTemplate db;
    private final UserRepository users;
    private final GoogleCalendarLessonService lessons;
    private final LessonPreparationRepository preparations;
    private final AiLessonPilotService evidence;
    private final WorkbookContentService content;
    private final OwnerWorkbookPdfRenderService renderer;
    private final LessonPdfDraftService drafts;
    private final PushSubscriptionRepository subscriptions;
    private final WebPushService webPush;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "owner-same-day-workbooks");
        thread.setDaemon(true);
        return thread;
    });
    private final Set<String> dispatched = ConcurrentHashMap.newKeySet();

    @Value("${app.owner-morning-workbook.enabled:false}")
    private boolean enabled;

    public OwnerSameDayWorkbookService(JdbcTemplate db, UserRepository users,
            GoogleCalendarLessonService lessons, LessonPreparationRepository preparations,
            AiLessonPilotService evidence, WorkbookContentService content,
            OwnerWorkbookPdfRenderService renderer, LessonPdfDraftService drafts,
            PushSubscriptionRepository subscriptions, WebPushService webPush) {
        this.db = db;
        this.users = users;
        this.lessons = lessons;
        this.preparations = preparations;
        this.evidence = evidence;
        this.content = content;
        this.renderer = renderer;
        this.drafts = drafts;
        this.subscriptions = subscriptions;
        this.webPush = webPush;
    }

    /** Immediate, post-commit trigger after the teacher presses Create lesson. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onLessonCreated(OwnerWorkbookLessonCreated created) {
        if (!enabled || !OWNER.equals(created.teacherId())) return;
        try {
            // The post-commit event may still hold the completed transaction's
            // connection in the publishing thread. Do all writes on the worker.
            worker.submit(() -> {
                try {
                    User owner = owner();
                    if (owner == null) return;
                    AuthenticatedUser actor = actor(owner);
                    findLesson(actor, created.eventId()).ifPresent(lesson -> enqueue(actor, lesson, false));
                } catch (RuntimeException ex) {
                    LOG.warn("Owner workbook event dispatch failed for {}: {}",
                            created.eventId(), ex.getClass().getSimpleName());
                }
            });
        } catch (RuntimeException ex) {
            LOG.warn("Owner workbook creation trigger failed for event {}: {}",
                    created.eventId(), ex.getClass().getSimpleName());
        }
    }

    /** At 09:00, and each minute after, look at TODAY's upcoming lessons only.
     * The extra scans pick up imported Google Calendar changes and queued jobs
     * left after an application restart. No future-month batch generation.
     */
    @Scheduled(cron = "0 * * * * *", zone = "Europe/Berlin")
    public void scanToday() {
        if (!enabled || LocalTime.now(BERLIN).isBefore(START_AT)) return;
        User owner = owner();
        if (owner == null) return;
        AuthenticatedUser actor = actor(owner);
        db.update("""
            UPDATE owner_same_day_workbook_jobs SET state='QUEUED', updated_at=now()
            WHERE teacher_id=? AND state='RUNNING'
              AND lesson_date=? AND updated_at < now() - INTERVAL '10 minutes'
            """, OWNER, LocalDate.now(BERLIN));
        List<GroupLessonResponse> today = lessons.listSavedGroupLessons(actor);
        for (GroupLessonResponse lesson : today) {
            try {
                enqueue(actor, lesson, false);
            } catch (RuntimeException ex) {
                LOG.warn("Owner workbook scan failed for event {}: {}",
                        lesson.eventId(), ex.getClass().getSimpleName());
            }
        }
    }

    /** Optional same-day retry from the lesson screen; no global or future-date action. */
    public Map<String, Object> createNow(AuthenticatedUser actor, String eventId) {
        requireOwner(actor);
        if (!enabled) throw new IllegalStateException("Private workbook pilot is disabled");
        GroupLessonResponse lesson = findLesson(actor, eventId)
                .orElseThrow(() -> new IllegalArgumentException("Lesson not found"));
        return enqueue(actor, lesson, true);
    }

    public Map<String, Object> status(AuthenticatedUser actor, String eventId) {
        requireOwner(actor);
        List<Map<String, Object>> records = db.queryForList("""
            SELECT state, error_code, created_at, updated_at
            FROM owner_same_day_workbook_jobs WHERE teacher_id=? AND event_id=?
            """, OWNER, eventId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", enabled);
        result.put("eventId", eventId);
        result.put("state", records.isEmpty() ? "NOT_STARTED" : records.get(0).get("state"));
        if (!records.isEmpty()) result.put("updatedAt", records.get(0).get("updated_at").toString());
        return result;
    }

    private Map<String, Object> enqueue(AuthenticatedUser actor, GroupLessonResponse lesson, boolean retryFailed) {
        if (!eligible(actor, lesson)) return Map.of("state", "NOT_ELIGIBLE", "eventId", lesson.eventId());
        // Existing teacher-created material always wins, even a partial pair.
        if (hasAnyMaterial(actor, lesson.eventId())) return Map.of("state", "ALREADY_ATTACHED", "eventId", lesson.eventId());
        db.update("""
            INSERT INTO owner_same_day_workbook_jobs(teacher_id,event_id,lesson_date,state)
            VALUES (?,?,?,'QUEUED') ON CONFLICT (teacher_id,event_id) DO NOTHING
            """, OWNER, lesson.eventId(), LocalDate.now(BERLIN));
        if (retryFailed) db.update("""
            UPDATE owner_same_day_workbook_jobs
               SET state='QUEUED', error_code=NULL, updated_at=now()
             WHERE teacher_id=? AND event_id=? AND state='FAILED'
            """, OWNER, lesson.eventId());
        List<String> states = db.queryForList("""
            SELECT state FROM owner_same_day_workbook_jobs WHERE teacher_id=? AND event_id=?
            """, String.class, OWNER, lesson.eventId());
        String state = states.isEmpty() ? "NOT_STARTED" : states.get(0);
        if ("QUEUED".equals(state) && dispatched.add(lesson.eventId())) {
            worker.submit(() -> {
                try { run(lesson.eventId()); }
                finally { dispatched.remove(lesson.eventId()); }
            });
        }
        return Map.of("state", state, "eventId", lesson.eventId());
    }

    private void run(String eventId) {
        if (db.update("""
                UPDATE owner_same_day_workbook_jobs SET state='RUNNING', updated_at=now()
                WHERE teacher_id=? AND event_id=? AND state='QUEUED'
                """, OWNER, eventId) != 1) return;
        try {
            User owner = owner();
            if (owner == null) throw new IllegalStateException("OWNER_NOT_ACTIVE");
            AuthenticatedUser actor = actor(owner);
            GroupLessonResponse lesson = findLesson(actor, eventId)
                    .orElseThrow(() -> new IllegalStateException("LESSON_NOT_FOUND"));
            if (!eligible(actor, lesson) || hasAnyMaterial(actor, eventId)) {
                db.update("""
                    UPDATE owner_same_day_workbook_jobs SET state='SKIPPED', updated_at=now()
                    WHERE teacher_id=? AND event_id=?
                    """, OWNER, eventId);
                return;
            }
            Map<String, Object> context = evidence.workbookGenerationContext(actor, eventId);
            WorkbookContentService.Content generated = content.generate(context,
                    "Create the entire upcoming lesson's individual mathematics worksheet in German. "
                    + "Use the previous lesson, actually submitted homework evidence, and monthly plan. "
                    + "Target the calendar duration. Include full separate teacher solutions. "
                    + "Do not invent errors, and use the current school workbook prompt.");
            Map<String, Object> result = renderer.create(actor, eventId,
                    generated.lessonJson(), generated.lessonPlan(), generated.difficulties());
            UUID draftId = UUID.fromString(String.valueOf(result.get("draftId")));
            // Validate the day and start time again: AI or rendering may
            // finish after the lesson begins, or the teacher may reschedule.
            GroupLessonResponse latest = findLesson(actor, eventId).orElse(null);
            if (latest == null || !eligible(actor, latest) || hasAnyMaterial(actor, eventId)) {
                db.update("""
                    UPDATE owner_same_day_workbook_jobs SET state='SKIPPED', draft_id=?,updated_at=now()
                    WHERE teacher_id=? AND event_id=?
                    """, draftId, OWNER, eventId);
                return;
            }
            drafts.publish(actor, draftId, true);
            LessonPreparation prepared = preparations.findByTeacherIdAndEventId(OWNER, eventId)
                    .orElseThrow(() -> new IllegalStateException("LESSON_PDF_READBACK_FAILED"));
            if (!prepared.hasWorkbook() || !prepared.hasAnswers()) throw new IllegalStateException("LESSON_PDF_READBACK_FAILED");
            db.update("""
                UPDATE owner_same_day_workbook_jobs SET state='SUCCEEDED',
                  draft_id=?, error_code=NULL, updated_at=now()
                WHERE teacher_id=? AND event_id=?
                """, draftId, OWNER, eventId);
            push(owner, "Рабочая тетрадь готова",
                    "Тетрадь и ответы для " + target(lesson) + " созданы и прикреплены. Проверьте перед уроком.", eventId);
        } catch (Exception ex) {
            String code = ex.getClass().getSimpleName();
            LOG.error("Owner workbook generation failed for event {} [{}]", eventId, code, ex);
            db.update("""
                UPDATE owner_same_day_workbook_jobs SET state='FAILED',
                  error_code=?,updated_at=now() WHERE teacher_id=? AND event_id=?
                """, code.substring(0, Math.min(code.length(), 120)), OWNER, eventId);
            User owner = owner();
            if (owner != null) push(owner, "Не удалось создать тетрадь",
                    "Автоматическая подготовка не завершилась. Откройте урок для повторного запуска.", eventId);
        }
    }

    private void push(User owner, String title, String body, String eventId) {
        if (!webPush.isConfigured()) return;
        for (PushSubscription subscription : subscriptions.findAllByUserId(owner.getId())) {
            try { webPush.send(subscription, title, body, "/teacher/lessons/" + eventId); }
            catch (RuntimeException ignored) { /* One broken phone never blocks publication. */ }
        }
    }

    private java.util.Optional<GroupLessonResponse> findLesson(AuthenticatedUser actor, String eventId) {
        return lessons.listSavedGroupLessons(actor).stream()
                .filter(lesson -> eventId.equals(lesson.eventId())).findFirst();
    }

    static boolean eligibleAt(UUID teacherId, Instant lessonStart, Instant now, boolean hasTarget) {
        if (!OWNER.equals(teacherId) || lessonStart == null || !hasTarget) return false;
        var localNow = now.atZone(BERLIN);
        return !localNow.toLocalTime().isBefore(START_AT)
                && localNow.toLocalDate().equals(lessonStart.atZone(BERLIN).toLocalDate())
                && lessonStart.isAfter(now);
    }

    private boolean eligible(AuthenticatedUser actor, GroupLessonResponse lesson) {
        return enabled && eligibleAt(actor.id(), lesson.startsAt(), Instant.now(),
                lesson.studentId() != null || lesson.groupId() != null);
    }

    private boolean hasAnyMaterial(AuthenticatedUser actor, String eventId) {
        return preparations.findByTeacherIdAndEventId(actor.id(), eventId)
                .map(p -> p.hasWorkbook() || p.hasAnswers()).orElse(false);
    }

    private User owner() {
        return users.findById(OWNER)
                .filter(u -> u.getRole() == Role.TEACHER && !u.isArchived())
                .orElse(null);
    }

    private AuthenticatedUser actor(User user) {
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole());
    }

    private static String target(GroupLessonResponse lesson) {
        if (lesson.groupName() != null && !lesson.groupName().isBlank()) return lesson.groupName();
        if (lesson.studentName() != null && !lesson.studentName().isBlank()) return lesson.studentName();
        return lesson.title();
    }

    private static void requireOwner(AuthenticatedUser actor) {
        if (actor == null || actor.role() != Role.TEACHER || !OWNER.equals(actor.id()))
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.NOT_FOUND, "Pilot unavailable");
    }

    @PreDestroy public void close() { worker.shutdownNow(); }
}
