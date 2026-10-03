package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.notifications.PushSubscription;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AiLessonPilotScheduler {

    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");

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
        if (!aiService.isConfigured()) return;

        User teacher = userRepository.findById(AiLessonPilotService.PILOT_TEACHER_ID)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElse(null);
        if (teacher == null || !teacher.isAiLessonPilotEnabled()) return;

        LocalTime nowTime = LocalTime.now(SCHOOL_ZONE).withSecond(0).withNano(0);
        LocalTime preparationTime = parseTime(teacher.getAiPreparationTime());
        if (nowTime.isBefore(preparationTime)) return;

        AuthenticatedUser caller = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        Instant now = Instant.now();
        LocalDate today = LocalDate.now(SCHOOL_ZONE);
        List<GroupLessonResponse> lessons = lessonService.listGroupLessons(caller);

        for (GroupLessonResponse lesson : lessons) {
            if (lesson.startsAt() == null || !lesson.startsAt().isAfter(now)) continue;
            if (!lesson.startsAt().atZone(SCHOOL_ZONE).toLocalDate().equals(today)) continue;
            if (lesson.groupId() == null && lesson.studentId() == null) continue;
            if (alreadyPrepared(teacher, lesson.eventId())) continue;

            try {
                aiService.prepareLesson(caller, lesson.eventId());
                notifyPrepared(teacher, lesson);
            } catch (RuntimeException ignored) {
                // The next scheduler run will retry only if the lesson is still unprepared.
            }
        }
    }

    private boolean alreadyPrepared(User teacher, String eventId) {
        LessonPreparation preparation = preparationRepository
                .findByTeacherIdAndEventId(teacher.getId(), eventId)
                .orElse(null);
        if (preparation == null) return false;
        return notBlank(preparation.getLessonPlan())
                || preparation.hasWorkbook()
                || preparation.hasAnswers();
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
