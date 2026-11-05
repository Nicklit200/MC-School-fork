package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.Role;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class PersonalLessonAnswersServiceTest {
    private final PersonalLessonAnswersRepository repository = mock(PersonalLessonAnswersRepository.class);
    private final PersonalLessonWorkbookService workbooks = mock(PersonalLessonWorkbookService.class);
    private final PersonalLessonAnswersService service = new PersonalLessonAnswersService(repository, workbooks);
    private final AuthenticatedUser teacher = new AuthenticatedUser(PersonalLessonWorkbookService.PILOT_TEACHER_ID, null, Role.TEACHER);
    private final UUID studentId = UUID.randomUUID();

    private byte[] pdf() throws Exception {
        try (var document = new PDDocument(); var output = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            document.save(output);
            return output.toByteArray();
        }
    }

    @Test
    void absentAnswersHaveHonestMetadataAndDoNotReadAnyWorkbook() {
        assertThat(service.metadata(teacher, "event", studentId))
                .isEqualTo(new PersonalLessonAnswersService.Metadata(studentId, false, null, 0L));
        verify(workbooks).requireLessonStudent(teacher, "event", studentId);
        verify(repository, never()).findByTeacherIdAndEventIdAndStudentId(any(), any(), any());
        verify(workbooks, never()).workbook(any(), any(), any());
        verify(workbooks, never()).upload(any(), any(), any(), any(), any());
    }

    @Test
    void metadataLoadsOnlyScalarProjection() {
        var row = mock(PersonalLessonAnswersRepository.Metadata.class);
        when(row.getFilename()).thenReturn("teacher-only.pdf");
        when(row.getVersion()).thenReturn(4L);
        when(row.getAnswersSizeBytes()).thenReturn(1234L);
        when(repository.metadataForStudent(teacher.id(), "event", studentId)).thenReturn(Optional.of(row));
        assertThat(service.metadata(teacher, "event", studentId))
                .isEqualTo(new PersonalLessonAnswersService.Metadata(studentId, true, "teacher-only.pdf", 5L, 1234L));
        verify(repository, never()).findByTeacherIdAndEventIdAndStudentId(any(), any(), any());
    }

    @Test
    void uploadsAnswersBeforeAWorkbookExistsAndKeepsTheExactTarget() throws Exception {
        byte[] bytes = pdf();
        when(repository.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        var saved = service.upload(teacher, "event", studentId, "C:\\fakepath\\solutions.pdf\r\n", bytes);
        assertThat(saved).isEqualTo(new PersonalLessonAnswersService.Metadata(studentId, true, "solutions.pdf", 1L, bytes.length));
        var captured = org.mockito.ArgumentCaptor.forClass(PersonalLessonAnswers.class);
        verify(repository).saveAndFlush(captured.capture());
        assertThat(captured.getValue().getTeacherId()).isEqualTo(teacher.id());
        assertThat(captured.getValue().getEventId()).isEqualTo("event");
        assertThat(captured.getValue().getStudentId()).isEqualTo(studentId);
        assertThat(captured.getValue().getAnswersPdf()).isEqualTo(bytes);
        verify(workbooks, never()).upload(any(), any(), any(), any(), any());
    }

    @Test
    void anIdenticalRetryDoesNotRewriteOrBumpAnswersVersion() throws Exception {
        byte[] bytes = pdf();
        var existing = PersonalLessonAnswers.create(teacher.id(), "event", studentId);
        existing.attach("solutions.pdf", bytes);
        ReflectionTestUtils.setField(existing, "version", 7L);
        when(repository.findByTeacherIdAndEventIdAndStudentId(teacher.id(), "event", studentId)).thenReturn(Optional.of(existing));
        assertThat(service.upload(teacher, "event", studentId, "solutions.pdf", bytes).version()).isEqualTo(8L);
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void unreadableAndOversizedFilesCannotChangeExistingAnswers() {
        for (byte[] bytes : List.of(new byte[0], "%PDF-corrupted".getBytes(), new byte[25 * 1024 * 1024 + 1])) {
            assertThatThrownBy(() -> service.upload(teacher, "event", studentId, "bad.pdf", bytes))
                    .isInstanceOf(ResponseStatusException.class);
        }
        verifyNoInteractions(repository);
    }

    @Test
    void allReadsAndWritesRecheckTheCurrentPilotLessonStudentBeforeTouchingStorage() throws Exception {
        byte[] bytes = pdf();
        doThrow(new ResourceNotFoundException("No longer assigned"))
                .when(workbooks).requireLessonStudent(teacher, "event", studentId);
        assertThatThrownBy(() -> service.metadata(teacher, "event", studentId)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.answers(teacher, "event", studentId)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.upload(teacher, "event", studentId, "file.pdf", bytes)).isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(repository);
    }

    @Test
    void aConcurrentInsertConflictIsReportedAsConflict() throws Exception {
        byte[] bytes = pdf();
        when(repository.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("duplicate"));
        assertThatThrownBy(() -> service.upload(teacher, "event", studentId, "solutions.pdf", bytes))
                .isInstanceOf(ConflictException.class);
    }
}
