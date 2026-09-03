package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

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

    @Override
    public void sendParentMissedHomework(User parent, User student, long unfinishedHomeworkCount) {
        log.info("[notification] Parent reminder for {} — child={} unfinishedHomework={} link={} (email not enabled)",
                parent.getEmail(), student.getFullName(), unfinishedHomeworkCount, appLinks.parentLink());
    }
}
