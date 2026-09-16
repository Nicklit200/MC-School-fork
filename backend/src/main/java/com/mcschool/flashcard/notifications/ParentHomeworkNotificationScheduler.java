package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.LocalDate;
import java.time.ZoneId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Evening parent-control check. At the configured cutoff, notify the linked parent
 * when the child still has unfinished PDF homework and/or due flashcards for today.
 *
 * The scheduler runs once per day, so one child produces at most one evening push
 * containing the complete current status instead of separate notifications for each
 * homework/card.
 */
@Component
@ConditionalOnProperty(name = "app.parent-homework-reminders.enabled", havingValue = "true")
public class ParentHomeworkNotificationScheduler {

    private static final Logger log = LoggerFactory.getLogger(ParentHomeworkNotificationScheduler.class);

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardRepository cardRepository;
    private final NotificationService notificationService;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;
    private final ZoneId zone;

    public ParentHomeworkNotificationScheduler(
            UserRepository userRepository,
            HomeworkRepository homeworkRepository,
            CardRepository cardRepository,
            NotificationService notificationService,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService,
            @Value("${app.parent-homework-reminders.zone:Europe/Berlin}") String zone) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.cardRepository = cardRepository;
        this.notificationService = notificationService;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
        this.zone = ZoneId.of(zone);
    }

    @Scheduled(
            cron = "${app.parent-homework-reminders.cron:0 0 19 * * *}",
            zone = "${app.parent-homework-reminders.zone:Europe/Berlin}")
    @Transactional(readOnly = true)
    public void notifyParents() {
        LocalDate today = LocalDate.now(zone);

        for (User student : userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)) {
            User parent = student.getParent();
            if (parent == null || parent.isArchived() || parent.getStatus() != UserStatus.ACTIVE) {
                continue;
            }

            long openHomeworks = homeworkRepository.countOpenWorksheetsForDay(student.getId(), today);
            long dueCards = cardRepository.countDueCards(student.getId(), today);
            if (openHomeworks == 0 && dueCards == 0) {
                continue;
            }

            // Keep the existing email/logging fallback for unfinished PDF homework.
            if (openHomeworks > 0) {
                notificationService.sendParentMissedHomework(parent, student, openHomeworks);
            }

            String body = buildPushBody(student.getFullName(), dueCards, openHomeworks);
            int subscriptions = 0;
            int delivered = 0;
            if (webPushService.isConfigured()) {
                for (PushSubscription subscription : subscriptionRepository.findAllByUserId(parent.getId())) {
                    subscriptions++;
                    try {
                        webPushService.send(subscription, "Mindcrafti School", body, "/parent");
                        delivered++;
                    } catch (RuntimeException ex) {
                        log.warn("Parent progress push failed: parentId={} studentId={} endpoint={}",
                                parent.getId(), student.getId(), subscription.getEndpoint(), ex);
                    }
                }
            }

            log.info(
                    "Parent progress check: parentId={} studentId={} openHomeworks={} dueCards={} subscriptions={} delivered={}",
                    parent.getId(), student.getId(), openHomeworks, dueCards, subscriptions, delivered);
        }
    }

    static String buildPushBody(String studentName, long dueCards, long openHomeworks) {
        if (dueCards > 0 && openHomeworks > 0) {
            return studentName + ": не выполнены " + dueCards + " карточек и " + openHomeworks + " домашняя работа.";
        }
        if (dueCards > 0) {
            return studentName + ": не выполнены карточки на сегодня — " + dueCards + ".";
        }
        return studentName + ": домашняя работа на сегодня ещё не выполнена.";
    }
}
