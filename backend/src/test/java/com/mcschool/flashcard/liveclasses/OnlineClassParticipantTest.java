package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

/**
 * Attendance must survive reconnects, which is the case a single join/leave pair
 * would get wrong.
 */
class OnlineClassParticipantTest {

    private static final Instant START = Instant.parse("2026-09-18T10:00:00Z");
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    private final User teacher = User.invitedTeacher("Teacher", "teacher@test.local",
            "t-token", START.plusSeconds(3600));
    private final User student = User.invitedStudent("Student", "student@test.local", teacher,
            "s-token", START.plusSeconds(3600));
    private final OnlineClass onlineClass =
            OnlineClass.forStudent(teacher, "event-1", "binding-1", "Maths", START, END, student);

    @Test
    void hostIsAdmittedImmediatelyAndMayShareScreen() {
        OnlineClassParticipant host = OnlineClassParticipant.host(onlineClass, teacher);

        assertThat(host.isHost()).isTrue();
        assertThat(host.isAdmitted()).isTrue();
        assertThat(host.isScreenShareEnabled()).isTrue();
    }

    @Test
    void studentWaitsWhenTheWaitingRoomIsEnabled() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        assertThat(participant.getAdmissionState()).isEqualTo(AdmissionState.PENDING);
        assertThat(participant.isScreenShareEnabled()).isFalse();
    }

    @Test
    void studentJoinsDirectlyWhenTheWaitingRoomIsDisabled() {
        onlineClass.setWaitingRoomEnabled(false);

        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        assertThat(participant.getAdmissionState()).isEqualTo(AdmissionState.ADMITTED);
    }

    @Test
    void attendanceAccumulatesAcrossReconnects() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        participant.markJoined(START);
        participant.markLeft(START.plusSeconds(600));          // 10 minutes
        participant.markJoined(START.plusSeconds(900));
        participant.markLeft(START.plusSeconds(1500));         // a further 10 minutes

        assertThat(participant.getTotalConnectedSeconds()).isEqualTo(1200);
        assertThat(participant.getFirstJoinedAt()).isEqualTo(START);
        assertThat(participant.getLastJoinedAt()).isEqualTo(START.plusSeconds(900));
        assertThat(participant.isConnected()).isFalse();
    }

    @Test
    void firstJoinIsRememberedAcrossLaterJoins() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        participant.markJoined(START);
        participant.markLeft(START.plusSeconds(60));
        participant.markJoined(START.plusSeconds(120));

        assertThat(participant.getFirstJoinedAt()).isEqualTo(START);
        assertThat(participant.isConnected()).isTrue();
    }

    @Test
    void duplicateLeaveEventsDoNotInflateAttendance() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        participant.markJoined(START);
        participant.markLeft(START.plusSeconds(300));
        // A duplicate or out-of-order webhook must be ignored.
        participant.markLeft(START.plusSeconds(600));
        participant.markLeft(START.plusSeconds(900));

        assertThat(participant.getTotalConnectedSeconds()).isEqualTo(300);
    }

    @Test
    void leaveWithoutJoinIsIgnored() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        participant.markLeft(START.plusSeconds(300));

        assertThat(participant.getTotalConnectedSeconds()).isZero();
        assertThat(participant.isConnected()).isFalse();
    }

    @Test
    void admissionTransitions() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);

        participant.admit();
        assertThat(participant.isAdmitted()).isTrue();

        participant.reject();
        assertThat(participant.getAdmissionState()).isEqualTo(AdmissionState.REJECTED);
    }

    @Test
    void aRemovedParticipantIsNotSilentlyReadmitted() {
        OnlineClassParticipant participant = OnlineClassParticipant.student(onlineClass, student);
        participant.remove();

        assertThatThrownBy(participant::admit)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("removed participant");
        assertThat(participant.getAdmissionState()).isEqualTo(AdmissionState.REMOVED);
    }
}
