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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AiLessonPilotScheduler {

    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    private static final LocalTime MORNING_START = LocalTime.of(9, 0);
    private static final Logger LOG = LoggerFactory.getLogger(AiLessonPilotScheduler.class);
    private static final int MAX_DAILY_ATTEMPTS = 3;

    @Value("${app.ai-lesson-pilot.scheduler-enabled:false}")
    private boolean schedulerEnabled;

    // The owner workbook pilot is explicitly configured to run after 09:00.
    // Its morning homework analysis must not depend on the separate pilot
    // toggle in the teacher's profile, or on successful PDF rendering.
    @Value("${app.owner-morning-workbook.enabled:false}")
    private boolean ownerMorningWorkbookEnabled;

    private final ExecutorService preparationWorker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "morning-homework-digests");
        thread.setDaemon(true);
        return thread;
    });
    private final Set<String> inflight = ConcurrentHashMap.newKeySet();
    private final Map<String, Integer> failedAttempts = new ConcurrentHashMap<>();
    private final Map<String, Instant> nextRetry = new ConcurrentHashMap<>();

    private final UserRepository userRepository;
    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationRepository preparationRepository;
    private final AiLessonPilotService aiService;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;

    public AiLessonPilotScheduler(
            UserRepository userRepository,
            GoogleCalendarLessonService lessonService,
            LessonPreparationRepository preparationRepository,
            AiLessonPilotService aiService,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService) {
        this.userRepository = userRepository;
        this.lessonService = lessonService;
        this.preparationRepository = preparationRepository;
        this.aiService = aiService;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
    }

    @Scheduled(cron = "0 * * * * *", zone = "Europe/Berlin")
    public void prepareNickLessons() {
        if (!schedulerEnabled && !ownerMorningWorkbookEnabled) return;
        if (!aiService.isConfigured()) return;

        User teacher = userRepository.findById(AiLessonPilotService.PILOT_TEACHER_ID)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElse(null);
        if (teacher == null) return;

        LocalTime nowTime = LocalTime.now(SCHOOL_ZONE).withSecond(0).withNano(0);
        if (!shouldPrepare(schedulerEnabled, ownerMorningWorkbookEnabled,
                teacher.isAiLessonPilotEnabled(), parseTime(teacher.getAiPreparationTime()), nowTime))
            return;

        AuthenticatedUser caller = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(SCHOOL_ZONE);
        // All retries are scoped by school-local day so a failed lesson cannot
        // accumulate unlimited LLM calls from the one-minute scheduler.
        String prefix = today + "|";
        failedAttempts.keySet().removeIf(key -> !key.startsWith(prefix) && !inflight.contains(key));
        nextRetry.keySet().removeIf(key -> !key.startsWith(prefix) && !inflight.contains(key));
        List<GroupLessonResponse> lessons = lessonService.listGroupLessons(caller);

        for (GroupLessonResponse lesson : lessons) {
            if (lesson.startsAt() == null || !lesson.startsAt().isAfter(now)) continue;
            if (!lesson.startsAt().atZone(SCHOOL_ZONE).toLocalDate().equals(today)) continue;
            if (lesson.groupId() == null && lesson.studentId() == null) continue;
            if (alreadyPrepared(teacher, lesson.eventId())) continue;

            String key = prefix + lesson.eventId();
            if (failedAttempts.getOrDefault(key, 0) >= MAX_DAILY_ATTEMPTS) continue;
            Instant retryAt = nextRetry.get(key);
            if (retryAt != null && retryAt.isAfter(now)) continue;
            if (!inflight.add(key)) continue;

            try {
                preparationWorker.submit(() -> {
                    try {
                        // A human or another trigger may have populated the
                        // lesson while this job was waiting in the queue.
                        if (alreadyPrepared(teacher, lesson.eventId())) return;
                        aiService.prepareLesson(caller, lesson.eventId());
                        if (!alreadyPrepared(teacher, lesson.eventId()))
                            throw new IllegalStateException("Morning lesson digest is incomplete");
                        failedAttempts.remove(key);
                        nextRetry.remove(key);
                        LOG.info("Morning homework analysis ready event={}", lesson.eventId());
                        notifyPrepared(teacher, lesson);
                    } catch (RuntimeException failure) {
                        int attempt = failedAttempts.merge(key, 1, Integer::sum);
                        nextRetry.put(key, Instant.now().plus(Duration.ofMinutes(3)));
                        LOG.warn("Morning homework analysis failed event={} attempt={}/{} errorType={}",
                                lesson.eventId(), attempt, MAX_DAILY_ATTEMPTS,
                                failure.getClass().getSimpleName());
                        if (attempt >= MAX_DAILY_ATTEMPTS) notifyFailed(teacher, lesson);
                    } finally {
                        inflight.remove(key);
                    }
                });
            } catch (RuntimeException failure) {
                inflight.remove(key);
                LOG.warn("Morning homework analysis could not be queued event={} errorType={}",
                        lesson.eventId(), failure.getClass().getSimpleName());
            }
        }
    }

    static boolean shouldPrepare(boolean pilotScheduler, boolean ownerMorning,
            boolean teacherPilotEnabled, LocalTime teacherTime, LocalTime now) {
        return (ownerMorning && !now.isBefore(MORNING_START))
                || (pilotScheduler && teacherPilotEnabled && !now.isBefore(teacherTime));
    }

    @PreDestroy
    public void close() {
        preparationWorker.shutdownNow();
    }

    private boolean alreadyPrepared(User teacher, String eventId) {
        LessonPreparation preparation = preparationRepository
                .findByTeacherIdAndEventId(teacher.getId(), eventId)
                .orElse(null);
        if (preparation == null) return false;
        // Existing manually curated lesson digests also count. Never replace
        // the group lesson's confirmed errors just to satisfy the scheduler.
        String difficulties = preparation.getDifficulties();
        String homework = preparation.getHomeworkNotes();
        return difficulties != null && !difficulties.isBlank()
                && homework != null && !homework.isBlank();
    }

    private void notifyFailed(User teacher, GroupLessonResponse lesson) {
        if (!webPushService.isConfigured()) return;
        String url = "/teacher/lessons/" + lesson.eventId();
        for (PushSubscription subscription : subscriptionRepository.findAllByUserId(teacher.getId())) {
            try {
                webPushService.send(subscription, "Подготовка домашки не завершилась",
                        "Проверка домашней работы для урока не удалась после трёх попыток. Откройте урок.",
                        url);
            } catch (RuntimeException ignored) {
                // Push must not interrupt the next lesson's preparation.
            }
        }
    }

    private void notifyPrepared(User teacher, GroupLessonResponse lesson) {
        if (!webPushService.isConfigured()) return;
        String target = lesson.groupName() != null && !lesson.groupName().isBlank()
                ? lesson.groupName()
                : lesson.studentName() != null && !lesson.studentName().isBlank()
                    ? lesson.studentName()
                    : lesson.title();
        String body = "AI подготовил урок" + (target == null || target.isBlank() ? "." : " для " + target + ".") + " Проверьте материалы.";
        String url = "/teacher/lessons/" + lesson.eventId();
        for (PushSubscription subscription : subscriptionRepository.findAllByUserId(teacher.getId())) {
            try {
                webPushService.send(subscription, "Mindcrafti School", body, url);
            } catch (RuntimeException ignored) {
                // One broken device must not block the pilot.
            }
        }
    }

    private LocalTime parseTime(String value) {
        try {
            return LocalTime.parse(value == null || value.isBlank() ? "10:00" : value);
        } catch (RuntimeException ex) {
            return LocalTime.of(10, 0);
        }
    }

    private boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }
}
