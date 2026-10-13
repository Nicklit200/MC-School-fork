package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

/** Lifecycle rules of a class: legal transitions, idempotency, and targeting. */
class OnlineClassTest {

    private static final Instant START = Instant.parse("2026-09-18T10:00:00Z");
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    private final User teacher = User.invitedTeacher("Teacher", "teacher@test.local",
            "t-token", START.plusSeconds(3600));
    private final User student = User.invitedStudent("Student", "student@test.local", teacher,
            "s-token", START.plusSeconds(3600));

    private OnlineClass studentClass() {
        return OnlineClass.forStudent(teacher, "event-1", "binding-1", "Maths", START, END, student);
    }

    @Test
    void newClassStartsScheduledWithAnOpaqueRoomName() {
        OnlineClass onlineClass = studentClass();

        assertThat(onlineClass.getStatus()).isEqualTo(OnlineClassStatus.SCHEDULED);
        assertThat(onlineClass.isWaitingRoomEnabled()).isTrue();
        assertThat(onlineClass.isStudentScreenShareEnabled()).isFalse();
        assertThat(onlineClass.getRecordingState()).isEqualTo(ClassFeatureState.INACTIVE);
        // The room name must leak neither the participants nor the calendar event.
        assertThat(onlineClass.getRoomName()).contains(onlineClass.getId().toString());
        assertThat(onlineClass.getRoomName())
                .doesNotContain("event-1")
                .doesNotContain("teacher@test.local")
                .doesNotContain("student@test.local");
    }

    @Test
    void aClassTargetsExactlyOneStudentOrGroup() {
        OnlineClass direct = studentClass();
        assertThat(direct.isGroupClass()).isFalse();
        assertThat(direct.getStudent()).isEqualTo(student);

        StudentGroup group = StudentGroup.create(teacher, "Group A");
        OnlineClass groupClass =
                OnlineClass.forGroup(teacher, "event-2", "binding-2", "Maths", START, END, group);
        assertThat(groupClass.isGroupClass()).isTrue();
        assertThat(groupClass.getStudent()).isNull();
    }

    @Test
    void endMustBeAfterStart() {
        assertThatThrownBy(() -> OnlineClass.forStudent(teacher, "e", "b", "Maths", END, START, student))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Scheduled end must be after");
    }

    @Test
    void lifecycleOperationsAreIdempotent() {
        OnlineClass onlineClass = studentClass();

        onlineClass.openLobby();
        onlineClass.openLobby();
        assertThat(onlineClass.getStatus()).isEqualTo(OnlineClassStatus.LOBBY_OPEN);

        onlineClass.start(START);
        onlineClass.start(START.plusSeconds(120));
        assertThat(onlineClass.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        // A repeated start must not move the recorded start time.
        assertThat(onlineClass.getActualStartAt()).isEqualTo(START);

        onlineClass.end(END);
        onlineClass.end(END.plusSeconds(120));
        assertThat(onlineClass.getStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(onlineClass.getActualEndAt()).isEqualTo(END);
    }

    @Test
    void openingTheLobbyOfALiveClassDoesNotRegressStatus() {
        OnlineClass onlineClass = studentClass();
        onlineClass.start(START);

        onlineClass.openLobby();

        assertThat(onlineClass.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
    }

    @Test
    void endingClearsRecordingAndTranscriptionState() {
        OnlineClass onlineClass = studentClass();
        onlineClass.start(START);
        onlineClass.setRecordingState(ClassFeatureState.ACTIVE);
        onlineClass.setTranscriptionState(ClassFeatureState.ACTIVE);

        onlineClass.end(END);

        assertThat(onlineClass.getRecordingState()).isEqualTo(ClassFeatureState.INACTIVE);
        assertThat(onlineClass.getTranscriptionState()).isEqualTo(ClassFeatureState.INACTIVE);
    }

    @Test
    void aStartedClassCannotBeCancelled() {
        OnlineClass onlineClass = studentClass();
        onlineClass.start(START);

        assertThatThrownBy(onlineClass::cancel)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("already started");
    }

    @Test
    void aCancelledClassCannotBeStartedOrEnded() {
        OnlineClass onlineClass = studentClass();
        onlineClass.cancel();

        assertThatThrownBy(() -> onlineClass.start(START)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> onlineClass.end(END)).isInstanceOf(IllegalStateException.class);
        assertThat(onlineClass.isTerminal()).isTrue();
    }

    @Test
    void cancellingTwiceIsANoOp() {
        OnlineClass onlineClass = studentClass();
        onlineClass.cancel();
        onlineClass.cancel();

        assertThat(onlineClass.getStatus()).isEqualTo(OnlineClassStatus.CANCELLED);
    }

    @Test
    void onlyLobbyOrLiveClassesAreConnectable() {
        OnlineClass onlineClass = studentClass();
        assertThat(onlineClass.isConnectable()).isFalse();

        onlineClass.openLobby();
        assertThat(onlineClass.isConnectable()).isTrue();

        onlineClass.start(START);
        assertThat(onlineClass.isConnectable()).isTrue();

        onlineClass.end(END);
        assertThat(onlineClass.isConnectable()).isFalse();
    }
}
