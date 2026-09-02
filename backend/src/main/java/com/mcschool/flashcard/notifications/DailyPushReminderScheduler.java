package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Sends the student's due cards and due PDF homework every morning. */
@Component
@ConditionalOnProperty(name = "app.web-push.reminders.enabled", havingValue = "true")
public class DailyPushReminderScheduler {

    private final UserRepository userRepository;
    private final CardRepository cardRepository;
    private final HomeworkRepository homeworkRepository;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;
    private final ZoneId zone;

    public DailyPushReminderScheduler(UserRepository userRepository,
                                      CardRepository cardRepository,
                                      HomeworkRepository homeworkRepository,
                                      PushSubscriptionRepository subscriptionRepository,
                                      WebPushService webPushService,
                                      @Value("${app.web-push.reminders.zone:Europe/Berlin}") String zone) {
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
        this.homeworkRepository = homeworkRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
        this.zone = ZoneId.of(zone);
    }

    @Scheduled(cron = "${app.web-push.reminders.cron:0 0 8 * * *}", zone = "${app.web-push.reminders.zone:Europe/Berlin}")
    public void sendDailyReminders() {
        if (!webPushService.isConfigured()) return;

        LocalDate today = LocalDate.now(zone);
        for (User student : userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)) {
            long cards = cardRepository.countDueCards(student.getId(), today);
            long homeworks = homeworkRepository.countOpenWorksheetsForDay(student.getId(), today);
            if (cards == 0 && homeworks == 0) continue;

            String body = buildBody(cards, homeworks);
            for (PushSubscription subscription : subscriptionRepository.findAllByUserId(student.getId())) {
                try {
                    webPushService.send(subscription, "Mindcrafti School", body, "/today");
                } catch (RuntimeException ignored) {
                    // One expired/broken device subscription must not stop reminders for other students.
                }
            }
        }
    }

    private static String buildBody(long cards, long homeworks) {
        if (cards > 0 && homeworks > 0) {
            return "На сегодня: " + cards + " карточек и " + homeworks + " домашка.";
        }
        if (cards > 0) {
            return "На сегодня к повторению: " + cards + " карточек.";
        }
        return "На сегодня есть домашка: " + homeworks + ".";
    }
}
