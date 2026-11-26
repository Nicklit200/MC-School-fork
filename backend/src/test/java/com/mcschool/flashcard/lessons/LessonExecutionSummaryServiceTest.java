package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class LessonExecutionSummaryServiceTest {
    private static final Instant START = Instant.parse("2026-11-26T16:00:00Z");
    private static final Instant END = START.plusSeconds(2700);
    private final OnlineClassRepository classes = mock(OnlineClassRepository.class);
    private final LessonExecutionSummaryService service = new LessonExecutionSummaryService(classes);
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "hash");
    private final User formerTeacher = User.activeTeacher("Former teacher", "former@test.local", "former", "hash");
    private final User student = User.invitedStudent("Student", "student@test.local", teacher,
            "student-token", END);

    @Test
    void batchesCurrentEventsAndKeepsTheNewestMaterializationEvenAfterAMove() {
        GroupLessonResponse moved = lesson("moved");
        GroupLessonResponse completed = lesson("completed");
        GroupLessonResponse noRoom = lesson("no-room");
        OnlineClass retired = room(teacher, "moved", START.plusSeconds(86400), START.minusSeconds(600));
        retired.start(START);
        retired.end(END);
        OnlineClass replacement = room(teacher, "moved", START, START.minusSeconds(300));
        replacement.cancel();
        OnlineClass finished = room(teacher, "completed", START, START.minusSeconds(500));
        finished.start(START.plusSeconds(60));
        finished.end(END);
        // Repository order is creation time, not scheduled date. A retired room
        // with a later scheduled date must not make the replacement look taught.
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(
                teacher.getId(), List.of("moved", "completed", "no-room")))
                .thenReturn(List.of(replacement, finished, retired));

        List<GroupLessonResponse> result = service.enrichCurrent(teacher.getId(), List.of(moved, completed, noRoom));

        assertThat(result).extracting(GroupLessonResponse::eventId).containsExactly("moved", "completed", "no-room");
        assertThat(result.get(0).onlineClassStatus()).isEqualTo(OnlineClassStatus.CANCELLED);
        assertThat(result.get(0).actualStartAt()).isNull();
        assertThat(result.get(1).onlineClassStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(result.get(1).actualStartAt()).isEqualTo(START.plusSeconds(60));
        assertThat(result.get(1).actualEndAt()).isEqualTo(END);
        assertThat(result.get(1).startsAt()).isEqualTo(START);
        assertThat(result.get(1).endsAt()).isEqualTo(END);
        assertThat(result.get(1).participantStudentIds()).containsExactly(student.getId());
        assertThat(result.get(2).onlineClassStatus()).isNull();
        assertThat(result.get(2).actualStartAt()).isNull();
        verify(classes).findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(
                teacher.getId(), List.of("moved", "completed", "no-room"));
        verifyNoMoreInteractions(classes);
    }

    @Test
    void keepsFormerTeachersIsolatedEvenWhenTheirEventIdsMatch() {
        OnlineClass first = room(teacher, "same-event", START, START.minusSeconds(500));
        first.start(START);
        first.end(END);
        OnlineClass second = room(formerTeacher, "same-event", START, START.minusSeconds(300));
        second.cancel();
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(teacher.getId(), List.of("same-event")))
                .thenReturn(List.of(first));
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(formerTeacher.getId(), List.of("same-event")))
                .thenReturn(List.of(second));
        StudentLessonHistoryItem historyA = history(teacher, "same-event");
        StudentLessonHistoryItem historyB = history(formerTeacher, "same-event");

        List<StudentLessonHistoryItem> result = service.enrichHistory(student.getId(), List.of(historyA, historyB));

        assertThat(result.get(0).onlineClassStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(result.get(0).sourceTeacherId()).isEqualTo(teacher.getId());
        assertThat(result.get(0).actualStartAt()).isEqualTo(START);
        assertThat(result.get(1).onlineClassStatus()).isEqualTo(OnlineClassStatus.CANCELLED);
        assertThat(result.get(1).sourceTeacherId()).isEqualTo(formerTeacher.getId());
        assertThat(result.get(1).actualStartAt()).isNull();
        verify(classes).findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(teacher.getId(), List.of("same-event"));
        verify(classes).findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(formerTeacher.getId(), List.of("same-event"));
        verifyNoMoreInteractions(classes);
    }

    @Test
    void endingANeverStartedRoomDoesNotInventActualStartEvidence() {
        OnlineClass neverStarted = room(teacher, "never-started", START, START.minusSeconds(300));
        neverStarted.end(END);
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(teacher.getId(), List.of("never-started")))
                .thenReturn(List.of(neverStarted));

        GroupLessonResponse result = service.enrichCurrent(teacher.getId(), List.of(lesson("never-started"))).get(0);

        assertThat(result.onlineClassStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(result.actualEndAt()).isEqualTo(END);
        assertThat(result.actualStartAt()).isNull();
    }

    @Test
    void rebindingALessonDoesNotReuseAnotherStudentsCompletedRoom() {
        OnlineClass previousAudience = room(teacher, "rebound", START, START.minusSeconds(300));
        previousAudience.start(START);
        previousAudience.end(END);
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(teacher.getId(), List.of("rebound")))
                .thenReturn(List.of(previousAudience));
        User replacement = User.invitedStudent("Other student", "other@test.local", teacher, "other-token", END);
        GroupLessonResponse lesson = new GroupLessonResponse("rebound", "rebound", null, null,
                replacement.getId(), replacement.getFullName(), List.of(replacement.getId()),
                "Mathematics", START, END, null, null);

        GroupLessonResponse result = service.enrichCurrent(teacher.getId(), List.of(lesson)).get(0);

        assertThat(result.studentId()).isEqualTo(replacement.getId());
        assertThat(result.onlineClassStatus()).isNull();
        assertThat(result.actualStartAt()).isNull();
    }

    @Test
    void historicalRosterDoesNotAttachANewerIndividualRoomForAnotherPupil() {
        OnlineClass originalRoom = room(formerTeacher, "rebound-history", START, START.minusSeconds(600));
        originalRoom.start(START);
        originalRoom.end(END);
        User replacement = User.invitedStudent("Other student", "other@test.local", formerTeacher, "other-token", END);
        OnlineClass replacementRoom = OnlineClass.forStudent(formerTeacher, "rebound-history", "rebound-history",
                "Mathematics", START, END, replacement);
        ReflectionTestUtils.setField(replacementRoom, "createdAt", START.minusSeconds(300));
        replacementRoom.start(START.plusSeconds(120));
        replacementRoom.end(END.plusSeconds(120));
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(formerTeacher.getId(), List.of("rebound-history")))
                .thenReturn(List.of(replacementRoom, originalRoom));
        StudentLessonHistoryService history = mock(StudentLessonHistoryService.class);
        var caller = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(history.list(caller, student.getId())).thenReturn(List.of(history(formerTeacher, "rebound-history")));
        var controller = new StudentLessonHistoryController(history, service);

        StudentLessonHistoryItem result = controller.list(caller, student.getId()).get(0);

        assertThat(result.eventId()).isEqualTo("rebound-history");
        assertThat(result.sourceTeacherId()).isEqualTo(formerTeacher.getId());
        assertThat(result.onlineClassStatus()).isNull();
        assertThat(result.actualStartAt()).isNull();
        assertThat(result.actualEndAt()).isNull();
    }

    @Test
    void historicalGroupAccessRemainsAvailableButTeacherOnlyRehearsalsAreNotEvidence() {
        StudentGroup group = StudentGroup.create(formerTeacher, "Former group");
        OnlineClass groupRoom = OnlineClass.forGroup(formerTeacher, "group-history", "group-history",
                "Mathematics", START, END, group);
        groupRoom.start(START);
        groupRoom.end(END);
        OnlineClass rehearsal = OnlineClass.forTeacherOnly(formerTeacher, "rehearsal", "rehearsal",
                "Mathematics", START, END);
        rehearsal.start(START);
        rehearsal.end(END);
        when(classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(formerTeacher.getId(), List.of("group-history", "rehearsal")))
                .thenReturn(List.of(groupRoom, rehearsal));
        StudentLessonHistoryItem authorizedGroup = new StudentLessonHistoryItem(formerTeacher.getId(),
                formerTeacher.getFullName(), "group-history", "Mathematics", group.getName(),
                START, END, false, false, false);

        List<StudentLessonHistoryItem> result = service.enrichHistory(student.getId(),
                List.of(authorizedGroup, history(formerTeacher, "rehearsal")));

        assertThat(result.get(0).onlineClassStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(result.get(0).actualStartAt()).isEqualTo(START);
        assertThat(result.get(1).onlineClassStatus()).isNull();
        assertThat(result.get(1).actualStartAt()).isNull();
        assertThat(result.get(1).actualEndAt()).isNull();
    }

    @Test
    void unauthorizedStudentHistoryNeverTriggersALifecycleLookup() {
        StudentLessonHistoryService history = mock(StudentLessonHistoryService.class);
        var controller = new StudentLessonHistoryController(history, service);
        var caller = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(history.list(caller, student.getId())).thenThrow(new ResourceNotFoundException("Student not found"));

        assertThatThrownBy(() -> controller.list(caller, student.getId())).isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(classes);
    }

    @Test
    void emptyCalendarsDoNotIssueAnUnboundedQuery() {
        assertThat(service.enrichCurrent(teacher.getId(), List.of())).isEmpty();
        assertThat(service.enrichHistory(student.getId(), List.of())).isEmpty();
        verifyNoInteractions(classes);
    }

    private GroupLessonResponse lesson(String eventId) {
        return new GroupLessonResponse(eventId, eventId, null, null, student.getId(), student.getFullName(),
                List.of(student.getId()), "Mathematics", START, END, null, null);
    }

    private StudentLessonHistoryItem history(User owner, String eventId) {
        return new StudentLessonHistoryItem(owner.getId(), owner.getFullName(), eventId, "Mathematics", null,
                START, END, true, false, false);
    }

    private OnlineClass room(User owner, String eventId, Instant scheduledStart, Instant createdAt) {
        OnlineClass room = OnlineClass.forStudent(owner, eventId, eventId, "Mathematics",
                scheduledStart, scheduledStart.plusSeconds(2700), student);
        ReflectionTestUtils.setField(room, "createdAt", createdAt);
        return room;
    }
}
