package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class StudentLessonHistoryMembershipTest {
    private static final Instant START = Instant.parse("2026-11-25T16:00:00Z");
    private final UserRepository users = mock(UserRepository.class);
    private final LessonHistoryRepository history = mock(LessonHistoryRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final StudentLessonHistoryService service = new StudentLessonHistoryService(users, history,
            mock(LessonPreparationRepository.class), members, mock(JdbcTemplate.class));
    private final User currentTeacher = User.activeTeacher("Current", "current@test.local", "current", "hash");
    private final User formerTeacher = User.activeTeacher("Former", "former@test.local", "former", "hash");
    private final User student = User.invitedStudent("Student", "student@test.local", currentTeacher, "token", START);
    private final AuthenticatedUser caller = new AuthenticatedUser(currentTeacher.getId(), null, Role.TEACHER);

    @BeforeEach
    void assignedStudent() {
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
    }

    @Test
    void removedIndividualPupilCannotReappearThroughTheOriginalStudentBinding() {
        LessonHistoryEntry entry = individual("individual");
        entry.replaceParticipants(List.of());
        when(history.findAllByStudentIdAndDeletedAtIsNullOrderByStartsAtDesc(student.getId()))
                .thenReturn(List.of(entry));
        when(history.findByTeacherIdAndEventId(formerTeacher.getId(), entry.getEventId()))
                .thenReturn(Optional.of(entry));

        assertThat(service.list(caller, student.getId())).isEmpty();
        assertThatThrownBy(() -> service.detail(caller, student.getId(), formerTeacher.getId(), entry.getEventId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void emptyEditedRosterDoesNotFallBackToPermanentGroupMembership() {
        StudentGroup group = memberOfGroup();
        LessonHistoryEntry entry = groupLesson("removed-group", group);
        entry.replaceParticipants(List.of());
        when(history.findAllByGroupIdAndDeletedAtIsNullOrderByStartsAtDesc(group.getId())).thenReturn(List.of(entry));
        when(history.findByTeacherIdAndEventId(formerTeacher.getId(), entry.getEventId()))
                .thenReturn(Optional.of(entry));

        assertThat(service.list(caller, student.getId())).isEmpty();
        assertThatThrownBy(() -> service.detail(caller, student.getId(), formerTeacher.getId(), entry.getEventId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void explicitSnapshotKeepsHistoricalAccessAfterLeavingTheGroup() {
        StudentGroup oldGroup = StudentGroup.create(formerTeacher, "Old group");
        LessonHistoryEntry entry = groupLesson("attended-group", oldGroup);
        entry.replaceParticipants(List.of(student.getId()));
        when(history.findAllByParticipantStudentIdsContainingAndDeletedAtIsNullOrderByStartsAtDesc(student.getId().toString()))
                .thenReturn(List.of(entry));
        when(history.findByTeacherIdAndEventId(formerTeacher.getId(), entry.getEventId()))
                .thenReturn(Optional.of(entry));

        assertThat(service.list(caller, student.getId())).extracting(StudentLessonHistoryItem::eventId)
                .containsExactly("attended-group");
        assertThat(service.detail(caller, student.getId(), formerTeacher.getId(), entry.getEventId()).sourceTeacherId())
                .isEqualTo(formerTeacher.getId());
    }

    @Test
    void legacyGroupHistoryStillUsesMembershipWhenNoExplicitRosterExists() {
        StudentGroup group = memberOfGroup();
        LessonHistoryEntry entry = groupLesson("legacy-group", group);
        when(history.findAllByGroupIdAndDeletedAtIsNullOrderByStartsAtDesc(group.getId())).thenReturn(List.of(entry));

        assertThat(service.list(caller, student.getId())).extracting(StudentLessonHistoryItem::eventId)
                .containsExactly("legacy-group");
    }

    private StudentGroup memberOfGroup() {
        StudentGroup group = StudentGroup.create(formerTeacher, "Group");
        StudentGroupMember membership = StudentGroupMember.create(group, student);
        ReflectionTestUtils.setField(membership, "createdAt", START.minusSeconds(86400));
        when(members.findAllByStudentIdOrderByCreatedAtAsc(student.getId())).thenReturn(List.of(membership));
        return group;
    }

    private LessonHistoryEntry individual(String eventId) {
        return LessonHistoryEntry.create(formerTeacher, new GroupLessonResponse(eventId, eventId, null, null,
                student.getId(), student.getFullName(), List.of(student.getId()), "Mathematics", START,
                START.plusSeconds(2700), null, null));
    }

    private LessonHistoryEntry groupLesson(String eventId, StudentGroup group) {
        return LessonHistoryEntry.create(formerTeacher, new GroupLessonResponse(eventId, eventId,
                group.getId(), group.getName(), null, null, List.of(), "Mathematics", START,
                START.plusSeconds(2700), null, null));
    }
}
