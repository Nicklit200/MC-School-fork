package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class OnlineClassTeacherOnlyTest {
    private static final Instant START = Instant.parse("2026-11-05T12:00:00Z");
    private static final Instant END = START.plusSeconds(3600);
    private final User teacher = User.activeTeacher("Teacher", "teacher@preview.test", "preview-teacher", "unused");
    private final User pupil = User.managedStudent("Pupil", teacher);
    private final StudentGroup group = StudentGroup.create(teacher, "Group");

    @Test
    void explicitTeacherOnlyFactoryCreatesAnUnassignedScheduledRoom() {
        var room = preview();
        assertUnassigned(room);
        assertThat(room.getId()).isNotNull();
        assertThat(room.getRoomName()).isEqualTo("mcs-" + room.getId());
        assertThat(room.getTeacher()).isSameAs(teacher);
        assertThat(room.getStatus()).isEqualTo(OnlineClassStatus.SCHEDULED);
        assertThat(room.isWaitingRoomEnabled()).isTrue();
        assertThat(room.isStudentScreenShareEnabled()).isFalse();
    }

    @Test
    void assignedFactoriesNeverSilentlyTurnNullTargetsIntoTeacherOnlyRooms() {
        assertThatThrownBy(() -> OnlineClass.forStudent(teacher, "event", "binding", "Lesson", START, END, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> OnlineClass.forGroup(teacher, "event", "binding", "Lesson", START, END, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void teacherOnlyRoomsKeepTheSameStrictScheduleValidation() {
        for (Instant invalidEnd : new Instant[] {START, START.minusSeconds(1)}) {
            assertThatThrownBy(() -> OnlineClass.forTeacherOnly(teacher, "event", "binding", "Lesson", START, invalidEnd))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void nullPromotionTargetsAreRejectedWithoutChangingThePreview() {
        var room = preview();
        assertThatThrownBy(() -> room.promoteToStudent(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> room.promoteToGroup(null)).isInstanceOf(IllegalArgumentException.class);
        assertUnassigned(room);
    }

    @ParameterizedTest
    @EnumSource(value = OnlineClassStatus.class, names = {"SCHEDULED", "LOBBY_OPEN", "LIVE"})
    void promotingToStudentKeepsThePreparedRoomAndItsLifecycle(OnlineClassStatus status) {
        var room = inState(status);
        var id = room.getId();
        String roomName = room.getRoomName();
        Instant actualStart = room.getActualStartAt();

        room.promoteToStudent(pupil);

        assertThat(room.isTeacherOnly()).isFalse();
        assertThat(room.getStudent()).isSameAs(pupil);
        assertThat(room.getGroup()).isNull();
        assertThat(room.isGroupClass()).isFalse();
        assertThat(room.getId()).isEqualTo(id);
        assertThat(room.getRoomName()).isEqualTo(roomName);
        assertOriginalIdentityAndSchedule(room, status, actualStart);
    }

    @ParameterizedTest
    @EnumSource(value = OnlineClassStatus.class, names = {"SCHEDULED", "LOBBY_OPEN", "LIVE"})
    void promotingToGroupKeepsThePreparedRoomAndItsLifecycle(OnlineClassStatus status) {
        var room = inState(status);
        var id = room.getId();
        String roomName = room.getRoomName();
        Instant actualStart = room.getActualStartAt();

        room.promoteToGroup(group);

        assertThat(room.isTeacherOnly()).isFalse();
        assertThat(room.getStudent()).isNull();
        assertThat(room.getGroup()).isSameAs(group);
        assertThat(room.isGroupClass()).isTrue();
        assertThat(room.getId()).isEqualTo(id);
        assertThat(room.getRoomName()).isEqualTo(roomName);
        assertOriginalIdentityAndSchedule(room, status, actualStart);
    }

    @Test
    void anAssignedRoomCannotBePromotedAgainOrAcquireASecondTarget() {
        var individual = OnlineClass.forStudent(teacher, "event", "binding", "Lesson", START, END, pupil);
        var grouped = OnlineClass.forGroup(teacher, "event", "binding", "Lesson", START, END, group);
        for (OnlineClass room : new OnlineClass[] {individual, grouped}) {
            assertThatThrownBy(() -> room.promoteToStudent(pupil)).isInstanceOf(IllegalStateException.class);
            assertThatThrownBy(() -> room.promoteToGroup(group)).isInstanceOf(IllegalStateException.class);
        }
        assertThat(individual.getStudent()).isSameAs(pupil);
        assertThat(individual.getGroup()).isNull();
        assertThat(grouped.getStudent()).isNull();
        assertThat(grouped.getGroup()).isSameAs(group);
    }

    @ParameterizedTest
    @EnumSource(value = OnlineClassStatus.class, names = {"ENDED", "CANCELLED"})
    void aTerminalPreviewCannotExposeItsPreparedRoomToANewAudience(OnlineClassStatus status) {
        var room = inState(status);
        assertThatThrownBy(() -> room.promoteToStudent(pupil)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> room.promoteToGroup(group)).isInstanceOf(IllegalStateException.class);
        assertUnassigned(room);
        assertThat(room.getStatus()).isEqualTo(status);
    }

    private OnlineClass preview() {
        return OnlineClass.forTeacherOnly(teacher, "event", "binding", "Lesson", START, END);
    }

    private OnlineClass inState(OnlineClassStatus status) {
        var room = preview();
        switch (status) {
            case LOBBY_OPEN -> room.openLobby();
            case LIVE -> room.start(START.plusSeconds(25));
            case ENDED -> { room.start(START.plusSeconds(25)); room.end(END); }
            case CANCELLED -> room.cancel();
            case SCHEDULED -> { }
        }
        return room;
    }

    private void assertUnassigned(OnlineClass room) {
        assertThat(room.isTeacherOnly()).isTrue();
        assertThat(room.isGroupClass()).isFalse();
        assertThat(room.getStudent()).isNull();
        assertThat(room.getGroup()).isNull();
    }

    private void assertOriginalIdentityAndSchedule(OnlineClass room, OnlineClassStatus status, Instant actualStart) {
        assertThat(room.getTeacher()).isSameAs(teacher);
        assertThat(room.getEventId()).isEqualTo("event");
        assertThat(room.getBindingKey()).isEqualTo("binding");
        assertThat(room.getTitle()).isEqualTo("Lesson");
        assertThat(room.getScheduledStartAt()).isEqualTo(START);
        assertThat(room.getScheduledEndAt()).isEqualTo(END);
        assertThat(room.getStatus()).isEqualTo(status);
        assertThat(room.getActualStartAt()).isEqualTo(actualStart);
        assertThat(room.getActualEndAt()).isNull();
    }
}
