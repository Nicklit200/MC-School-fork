package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.User;

/** Sends transactional notifications to users. */
public interface NotificationService {

    /** Owner-only alert after a real class ended with no saved transcript. 
     * Returning false keeps the durable alert pending for retry. */
    default boolean sendOwnerMissingTranscript(String subject, String body) {
        return false;
    }

    void sendInvitation(User invitee, String invitationToken);

    void sendDailyTaskReminder(User student, long dueCardCount, long dueHomeworkCount);

    /** Tell a linked parent that the child still has unfinished homework for today. */
    void sendParentMissedHomework(User parent, User student, long unfinishedHomeworkCount);
}
