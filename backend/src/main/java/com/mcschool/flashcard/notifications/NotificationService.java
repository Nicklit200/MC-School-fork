package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.User;

/**
 * Sends transactional notifications to users. The active implementation is chosen
 * by configuration: {@link LoggingNotificationService} by default (logs only), or
 * {@link EmailNotificationService} when {@code app.mail.enabled=true} and Brevo
 * API credentials are configured. Swapping providers requires no change to callers.
 */
public interface NotificationService {

    /** A new account was created; invite the person to set their password (PRD 4.7). */
    void sendInvitation(User invitee, String invitationToken);

    /** A student's daily cards/homework reminder. */
    void sendDailyTaskReminder(User student, long dueCardCount, long dueHomeworkCount);
}
