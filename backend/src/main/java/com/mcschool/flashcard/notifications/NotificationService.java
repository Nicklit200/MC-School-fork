package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.User;

/** Sends transactional notifications to users. */
public interface NotificationService {

    void sendInvitation(User invitee, String invitationToken);

    void sendDailyTaskReminder(User student, long dueCardCount, long dueHomeworkCount);

    /** Tell a linked parent that the child still has unfinished homework for today. */
    void sendParentMissedHomework(User parent, User student, long unfinishedHomeworkCount);
}
