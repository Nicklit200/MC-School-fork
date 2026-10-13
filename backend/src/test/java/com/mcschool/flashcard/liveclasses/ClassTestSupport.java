package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.users.User;

/** Shared fixtures for the online-class integration tests. */
final class ClassTestSupport {

    private ClassTestSupport() {
    }

    /**
     * Lets a student into the class, as the teacher does from the waiting room.
     * Chat, the board and the roster are only open to admitted students, so a
     * test about an in-class student must start from here.
     */
    static void admit(OnlineClassParticipantRepository participants, OnlineClass onlineClass, User student) {
        OnlineClassParticipant participant = participants
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId())
                .orElseGet(() -> participants.save(OnlineClassParticipant.student(onlineClass, student)));
        participant.admit();
        participants.save(participant);
    }
}
