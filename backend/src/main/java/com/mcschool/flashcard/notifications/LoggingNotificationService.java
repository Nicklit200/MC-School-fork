package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Default notification implementation, used when email is not enabled
 * ({@code app.mail.enabled} unset or false). It logs what would be sent — including
 * the activation link — so invitations still work in local development without an
 * email provider. Replaced by {@link EmailNotificationService} when mail is enabled.
 */
@Service
@ConditionalOnProperty(name = "app.mail.enabled", havingValue = "false", matchIfMissing = true)
public class LoggingNotificationService implements NotificationService {

    private static final Logger log = LoggerFactory.getLogger(LoggingNotificationService.class);

    private final AppLinks appLinks;

    public LoggingNotificationService(AppLinks appLinks) {
        this.appLinks = appLinks;
    }

    @Override
    public void sendInvitation(User invitee, String invitationToken) {
        log.info("[notification] Invitation for {} — activation link: {} (email not enabled)",
                invitee.getEmail(), appLinks.activationLink(invitationToken));
    }

    @Override
    public void sendDailyTaskReminder(User student, long dueCardCount, long dueHomeworkCount) {
        log.info("[notification] Daily reminder for {} — {} card(s), {} homework(s): {} (email not enabled)",
                student.getEmail(), dueCardCount, dueHomeworkCount, appLinks.todayLink());
    }
}
