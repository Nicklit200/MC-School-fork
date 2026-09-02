package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
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

/** Sends the morning email reminder for all tasks due today. */
@Component
@ConditionalOnProperty(name = "app.notifications.review-reminders.enabled", havingValue = "true")
public class ReviewReminderScheduler {

    private final UserRepository userRepository;
    private final CardRepository cardRepository;
    private final HomeworkRepository homeworkRepository;
    private final NotificationService notificationService;
    private final DailyReviewHistoryService historyService;
    private final ZoneId reviewRemindersZone;

    public ReviewReminderScheduler(UserRepository userRepository,
                                   CardRepository cardRepository,
                                   HomeworkRepository homeworkRepository,
                                   NotificationService notificationService,
                                   DailyReviewHistoryService historyService,
                                   @Value("${app.notifications.review-reminders.zone}") String reviewRemindersZone) {
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
        this.homeworkRepository = homeworkRepository;
        this.notificationService = notificationService;
        this.historyService = historyService;
        this.reviewRemindersZone = ZoneId.of(reviewRemindersZone);
    }

    @Scheduled(
            cron = "${app.notifications.review-reminders.cron}",
            zone = "${app.notifications.review-reminders.zone}")
    public void sendDueReminders() {
        LocalDate today = LocalDate.now(reviewRemindersZone);
        historyService.closeIncompleteDaysBefore(today);
        for (User student : userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)) {
            long dueCards = cardRepository.countDueCards(student.getId(), today);
            long dueHomeworks = homeworkRepository.countOpenWorksheetsForDay(student.getId(), today);
            if (dueCards == 0 && dueHomeworks == 0) continue;

            if (dueCards > 0) {
                historyService.recordDueSnapshot(student, today, dueCards);
            }
            notificationService.sendDailyTaskReminder(student, dueCards, dueHomeworks);
        }
    }
}
