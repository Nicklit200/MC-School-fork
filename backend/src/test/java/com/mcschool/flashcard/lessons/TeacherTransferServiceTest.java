package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TeacherTransferServiceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final LessonHistoryRepository lessonHistory = mock(LessonHistoryRepository.class);
    private final LessonPreparationRepository preparations = mock(LessonPreparationRepository.class);
    private final TeacherTransferService service =
            new TeacherTransferService(users, groups, members, lessonHistory, preparations);

    private final User oldTeacher = User.activeTeacher("Old Teacher", "old@test.local", "oldteacher", "hash");
    private final User newTeacher = User.activeTeacher("New Teacher", "new@test.local", "newteacher", "hash");

    @Test
    void singleStudentTransferCopiesFutureIndividualLessonAndPreparation() {
        User student = User.invitedStudent("Student One", "student@test.local", oldTeacher,
                "student-token", Instant.now().plusSeconds(3600));
        String oldEventId = "google-event-123";
        GroupLessonResponse oldLesson = new GroupLessonResponse(
                oldEventId, oldEventId, null, null, student.getId(), student.getFullName(),
                List.of(student.getId()), "Mathematics", Instant.now().plusSeconds(86400),
                Instant.now().plusSeconds(90000), "https://old-meet.invalid", "https://calendar.invalid");
        LessonHistoryEntry oldEntry = LessonHistoryEntry.create(oldTeacher, oldLesson);
        LessonPreparation oldPreparation = LessonPreparation.create(oldTeacher, oldEventId);
        oldPreparation.updateNotes("Homework", "Fractions", "Repeat fractions", "Transcript text");

        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        when(users.findById(newTeacher.getId())).thenReturn(Optional.of(newTeacher));
        when(members.findAllByStudentIdOrderByCreatedAtAsc(student.getId())).thenReturn(List.of());
        when(lessonHistory.findAllByTeacherIdAndDeletedAtIsNullOrderByStartsAtAsc(oldTeacher.getId()))
                .thenReturn(List.of(oldEntry));
        when(preparations.findByTeacherIdAndEventId(oldTeacher.getId(), oldEventId))
                .thenReturn(Optional.of(oldPreparation));
        when(lessonHistory.save(any(LessonHistoryEntry.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(preparations.save(any(LessonPreparation.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        var result = service.transferStudent(student.getId(), newTeacher.getId());

        assertThat(student.getTeacher().getId()).isEqualTo(newTeacher.getId());
        assertThat(result.student().teacherId()).isEqualTo(newTeacher.getId());
        assertThat(result.copiedFutureLessons()).isEqualTo(1);
        assertThat(result.futureGroupLessonsNotTransferred()).isZero();

        ArgumentCaptor<LessonHistoryEntry> lessonCaptor = ArgumentCaptor.forClass(LessonHistoryEntry.class);
        verify(lessonHistory).save(lessonCaptor.capture());
        GroupLessonResponse copiedLesson = lessonCaptor.getValue().toResponse();
        assertThat(copiedLesson.eventId()).startsWith("local-").isNotEqualTo(oldEventId);
        assertThat(copiedLesson.studentId()).isEqualTo(student.getId());
        assertThat(copiedLesson.meetUrl()).isNull();
        assertThat(copiedLesson.calendarUrl()).isNull();

        ArgumentCaptor<LessonPreparation> preparationCaptor = ArgumentCaptor.forClass(LessonPreparation.class);
        verify(preparations).save(preparationCaptor.capture());
        assertThat(preparationCaptor.getValue().getTeacher().getId()).isEqualTo(newTeacher.getId());
        assertThat(preparationCaptor.getValue().getEventId()).isEqualTo(copiedLesson.eventId());
        assertThat(preparationCaptor.getValue().getHomeworkNotes()).isEqualTo("Homework");
        assertThat(preparationCaptor.getValue().getTranscriptText()).isEqualTo("Transcript text");
    }

    @Test
    void bulkTransferMovesGroupsAndCopiesTheirFutureLessons() {
        User student = User.invitedStudent("Student Two", "student2@test.local", oldTeacher,
                "student-token-2", Instant.now().plusSeconds(3600));
        StudentGroup group = StudentGroup.create(oldTeacher, "Group A");
        StudentGroupMember membership = StudentGroupMember.create(group, student);
        String oldEventId = "google-group-event";
        GroupLessonResponse oldLesson = new GroupLessonResponse(
                oldEventId, oldEventId, group.getId(), group.getName(), null, null,
                List.of(student.getId()), "Fractions group", Instant.now().plusSeconds(172800),
                Instant.now().plusSeconds(176400), "https://old-meet.invalid", "https://calendar.invalid");
        LessonHistoryEntry oldEntry = LessonHistoryEntry.create(oldTeacher, oldLesson);

        when(users.findById(oldTeacher.getId())).thenReturn(Optional.of(oldTeacher));
        when(users.findById(newTeacher.getId())).thenReturn(Optional.of(newTeacher));
        when(users.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(oldTeacher.getId()))
                .thenReturn(List.of(student));
        when(groups.findAllByTeacherIdOrderByNameAsc(oldTeacher.getId())).thenReturn(List.of(group));
        when(members.findAllByGroupIdOrderByCreatedAtAsc(group.getId())).thenReturn(List.of(membership));
        when(lessonHistory.findAllByTeacherIdAndDeletedAtIsNullOrderByStartsAtAsc(oldTeacher.getId()))
                .thenReturn(List.of(oldEntry));
        when(lessonHistory.save(any(LessonHistoryEntry.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        var result = service.transferAllStudents(oldTeacher.getId(), newTeacher.getId());

        assertThat(result.transferredStudents()).isEqualTo(1);
        assertThat(result.transferredGroups()).isEqualTo(1);
        assertThat(result.copiedFutureLessons()).isEqualTo(1);
        assertThat(student.getTeacher().getId()).isEqualTo(newTeacher.getId());
        assertThat(group.getTeacher().getId()).isEqualTo(newTeacher.getId());

        ArgumentCaptor<LessonHistoryEntry> lessonCaptor = ArgumentCaptor.forClass(LessonHistoryEntry.class);
        verify(lessonHistory).save(lessonCaptor.capture());
        GroupLessonResponse copiedLesson = lessonCaptor.getValue().toResponse();
        assertThat(copiedLesson.groupId()).isEqualTo(group.getId());
        assertThat(copiedLesson.participantStudentIds()).containsExactly(student.getId());
        assertThat(copiedLesson.meetUrl()).isNull();
    }
}
