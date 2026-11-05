package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.*;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.users.*;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class PersonalLessonWorkbookServiceTest {
    private final PersonalLessonWorkbookRepository repository = mock(PersonalLessonWorkbookRepository.class);
    private final GoogleCalendarLessonService lessons = mock(GoogleCalendarLessonService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final LessonPreparationService preparations = mock(LessonPreparationService.class);
    private final PersonalLessonWorkbookService service = new PersonalLessonWorkbookService(repository, lessons, users, groups, members, preparations);
    private User teacher;
    private User student;
    private AuthenticatedUser caller;

    @BeforeEach
    void setup() {
        teacher = User.activeTeacher("Nick", "nick@test.local", "nick", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        student = User.managedStudent("Student", teacher);
        caller = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(users.existsByIdAndRoleAndStatusAndArchivedFalse(teacher.getId(), Role.TEACHER, UserStatus.ACTIVE)).thenReturn(true);
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        when(users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
                student.getId(), teacher.getId(), Role.STUDENT, UserStatus.ACTIVE)).thenReturn(true);
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(lesson(null, student.getId())));
    }

    private GroupLessonResponse lesson(UUID groupId, UUID studentId) {
        return new GroupLessonResponse("event", "event", groupId, null, studentId, null,
                List.of(), "Math", Instant.now(), Instant.now().plusSeconds(3600), null, null);
    }

    private byte[] pdf() throws Exception {
        try (var document = new PDDocument(); var out = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            document.save(out);
            return out.toByteArray();
        }
    }

    @Test
    void pilotRequiresExactActiveTeacherAccount() {
        var other = new AuthenticatedUser(UUID.randomUUID(), null, Role.TEACHER);
        assertThat(service.list(other, "event")).isEqualTo(new PersonalLessonWorkbookService.PersonalWorkbooksResponse(false, List.of()));
        assertThat(service.enabled(new AuthenticatedUser(teacher.getId(), null, Role.ADMIN))).isFalse();
        assertThat(service.enabled(new AuthenticatedUser(teacher.getId(), null, Role.STUDENT))).isFalse();
        assertThatThrownBy(() -> service.upload(other, "event", student.getId(), "file.pdf", new byte[0]))
                .isInstanceOf(ResourceNotFoundException.class);
        when(users.existsByIdAndRoleAndStatusAndArchivedFalse(teacher.getId(), Role.TEACHER, UserStatus.ACTIVE)).thenReturn(false);
        assertThat(service.enabled(caller)).isFalse();
        verifyNoInteractions(repository, lessons, preparations);
    }

    @Test
    void listUsesOnlyCurrentOwnActiveGroupStudentsAndMetadata() {
        StudentGroup group = StudentGroup.create(teacher, "Group");
        User inactive = User.managedStudent("Inactive", teacher);
        ReflectionTestUtils.setField(inactive, "status", UserStatus.INACTIVE);
        User foreign = User.managedStudent("Other", User.activeTeacher("Other", "other@test.local", "other", "unused"));
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(lesson(group.getId(), null)));
        when(groups.findByIdAndTeacherId(group.getId(), teacher.getId())).thenReturn(Optional.of(group));
        when(members.findAllByGroupIdOrderByStudentFullNameAsc(group.getId())).thenReturn(List.of(
                StudentGroupMember.create(group, inactive), StudentGroupMember.create(group, foreign), StudentGroupMember.create(group, student)));
        var metadata = mock(PersonalLessonWorkbookRepository.Metadata.class);
        when(metadata.getStudentId()).thenReturn(student.getId());
        when(metadata.getFilename()).thenReturn("mine.pdf");
        when(metadata.getVersion()).thenReturn(3L);
        when(metadata.getWorkbookSizeBytes()).thenReturn(1234L);
        when(repository.metadata(teacher.getId(), "event")).thenReturn(List.of(metadata));

        var result = service.list(caller, "event");
        assertThat(result.enabled()).isTrue();
        assertThat(result.students()).containsExactly(new PersonalLessonWorkbookService.PersonalWorkbookResponse(
                student.getId(), "Student", true, "mine.pdf", 4L, false, null, 0L, 1234L, 0L));
        verify(repository, never()).findByTeacherIdAndEventIdAndStudentId(any(), any(), any());
    }

    @Test
    void cannotAssignToDifferentStudentOrMissingEvent() throws Exception {
        byte[] bytes = pdf();
        assertThatThrownBy(() -> service.upload(caller, "event", UUID.randomUUID(), "personal.pdf", bytes))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.upload(caller, "missing", student.getId(), "personal.pdf", bytes))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(repository, preparations);
    }

    @Test
    void uploadsOnlyToTargetStudentAndSanitizesFilename() throws Exception {
        byte[] bytes = pdf();
        when(repository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        var response = service.upload(caller, "event", student.getId(), "C:\\fakepath\\mine.pdf\r\n", bytes);
        assertThat(response.studentId()).isEqualTo(student.getId());
        assertThat(response.filename()).isEqualTo("mine.pdf");
        assertThat(response.version()).isEqualTo(1L);
        assertThat(response.workbookSizeBytes()).isEqualTo(bytes.length);
        assertThat(response.answersSizeBytes()).isZero();
        var captured = org.mockito.ArgumentCaptor.forClass(PersonalLessonWorkbook.class);
        verify(repository).saveAndFlush(captured.capture());
        assertThat(captured.getValue().getTeacherId()).isEqualTo(teacher.getId());
        assertThat(captured.getValue().getWorkbookPdf()).isEqualTo(bytes);
        verify(preparations).getOrCreate(caller, "event");
    }

    @Test
    void identicalRetryDoesNotBumpVersionOrRewritePdf() throws Exception {
        byte[] bytes = pdf();
        var existing = PersonalLessonWorkbook.create(teacher.getId(), "event", student.getId());
        existing.attach("mine.pdf", bytes);
        ReflectionTestUtils.setField(existing, "version", 8L);
        when(repository.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()))
                .thenReturn(Optional.of(existing));
        assertThat(service.upload(caller, "event", student.getId(), "mine.pdf", bytes).version()).isEqualTo(9L);
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void corruptEmptyAndOversizedUploadsNeverOverwrite() {
        for (byte[] invalid : List.of(new byte[0], "%PDF-corrupted".getBytes(), new byte[25 * 1024 * 1024 + 1])) {
            assertThatThrownBy(() -> service.upload(caller, "event", student.getId(), "bad.pdf", invalid))
                    .isInstanceOf(ResponseStatusException.class);
        }
        verifyNoInteractions(repository, preparations);
    }

    @Test
    void classroomVersionProbeDoesNotLoadPdfAndRevokedOwnershipDeniesBothReads() {
        OnlineClass room = OnlineClass.forStudent(teacher, "event", "event", "Math", Instant.now(), Instant.now().plusSeconds(3600), student);
        when(repository.workbookVersion(teacher.getId(), "event", student.getId())).thenReturn(Optional.of(4L));
        assertThat(service.workbookVersionForClass(room, student.getId())).isEqualTo(5L);
        verify(repository, never()).findByTeacherIdAndEventIdAndStudentId(any(), any(), any());
        // The cached User still looks owned and active, but the current database predicate denies access.
        when(users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
                student.getId(), teacher.getId(), Role.STUDENT, UserStatus.ACTIVE)).thenReturn(false);
        assertThatThrownBy(() -> service.workbookForClass(room, student.getId())).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.workbookVersionForClass(room, student.getId())).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void teacherPreparationListJoinsAnswerMetadataWithoutLoadingAnyAnswerPdf() {
        var answerRepository = mock(PersonalLessonAnswersRepository.class);
        service.setAnswersRepository(answerRepository);
        var metadata = mock(PersonalLessonAnswersRepository.Metadata.class);
        when(metadata.getStudentId()).thenReturn(student.getId());
        when(metadata.getFilename()).thenReturn("private-solutions.pdf");
        when(metadata.getVersion()).thenReturn(2L);
        when(metadata.getAnswersSizeBytes()).thenReturn(5678L);
        when(answerRepository.metadata(teacher.getId(), "event")).thenReturn(List.of(metadata));
        var row = service.list(caller, "event").students().get(0);
        assertThat(row.hasWorkbook()).isFalse();
        assertThat(row.hasAnswers()).isTrue();
        assertThat(row.answersFilename()).isEqualTo("private-solutions.pdf");
        assertThat(row.answersVersion()).isEqualTo(3L);
        assertThat(row.workbookSizeBytes()).isZero();
        assertThat(row.answersSizeBytes()).isEqualTo(5678L);
        verify(answerRepository, never()).findByTeacherIdAndEventIdAndStudentId(any(), any(), any());
    }
}
