package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Evening check: once homework is still unfinished at the configured cutoff,
 * notify the linked parent once by email/logging and Web Push.
 */
@Component
@ConditionalOnProperty(name = "app.parent-homework-reminders.enabled", havingValue = "true")
public class ParentHomeworkNotificationScheduler {

    private static final Logger log = LoggerFactory.getLogger(ParentHomeworkNotificationScheduler.class);

    private final HomeworkRepository homeworkRepository;
    private final NotificationService notificationService;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;
    private final ZoneId zone;

    public ParentHomeworkNotificationScheduler(
            HomeworkRepository homeworkRepository,
            NotificationService notificationService,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService,
            @Value("${app.parent-homework-reminders.zone:Europe/Berlin}") String zone) {
        this.homeworkRepository = homeworkRepository;
        this.notificationService = notificationService;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
        this.zone = ZoneId.of(zone);
    }

    @Scheduled(
            cron = "${app.parent-homework-reminders.cron:0 0 20 * * *}",
            zone = "${app.parent-homework-reminders.zone:Europe/Berlin}")
    @Transactional
    public void notifyParents() {
        LocalDate today = LocalDate.now(zone);
        List<Homework> open = homeworkRepository.findOpenForParentNotification(today);
        if (open.isEmpty()) return;

        Map<UUID, List<Homework>> byStudent = open.stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        homework -> homework.getStudent().getId(), LinkedHashMap::new, java.util.stream.Collectors.toList()));

        Instant now = Instant.now();
        for (List<Homework> studentHomeworks : byStudent.values()) {
            Homework first = studentHomeworks.get(0);
            User student = first.getStudent();
            User parent = student.getParent();
            if (parent == null) continue;

            long count = studentHomeworks.size();
            notificationService.sendParentMissedHomework(parent, student, count);

            if (webPushService.isConfigured()) {
                String body = student.getFullName() + " ещё не выполнил(а) домашнюю работу на сегодня.";
                for (PushSubscription subscription : subscriptionRepository.findAllByUserId(parent.getId())) {
                    try {
                        webPushService.send(subscription, "Mindcrafti School", body, "/parent");
                    } catch (RuntimeException ex) {
                        log.warn("Parent push failed: parentId={} studentId={} endpoint={}",
                                parent.getId(), student.getId(), subscription.getEndpoint(), ex);
                    }
                }
            }

            for (Homework homework : studentHomeworks) {
                homework.markParentNotified(now);
            }
            log.info("Parent notified about unfinished homework: parentId={} studentId={} count={}",
                    parent.getId(), student.getId(), count);
        }
    }
}
