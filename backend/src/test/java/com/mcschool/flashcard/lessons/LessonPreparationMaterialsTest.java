package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class LessonPreparationMaterialsTest {
    private final LessonPreparationRepository repository = mock(LessonPreparationRepository.class);
    private final LessonDriveArchiveService drive = mock(LessonDriveArchiveService.class);
    private final User teacher = User.activeTeacher("Test teacher", "pdf-test@example.test", "pdf-test", "unused");
    private final AuthenticatedUser actor = new AuthenticatedUser(teacher.getId(), null, teacher.getRole());
    private final LessonPreparation preparation = LessonPreparation.create(teacher, "pdf-test-event");
    private final LessonPreparationService service = new LessonPreparationService(repository, mock(UserRepository.class), drive);

    @BeforeEach
    void setUp() {
        when(repository.findByTeacherIdAndEventId(teacher.getId(), "pdf-test-event")).thenReturn(Optional.of(preparation));
        when(repository.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        when(repository.save(any())).thenAnswer(call -> call.getArgument(0));
    }

    private byte[] pdf(int pages) throws Exception {
        try (var document = new PDDocument(); var bytes = new ByteArrayOutputStream()) {
            for (int page = 0; page < pages; page++) document.addPage(new PDPage());
            document.save(bytes);
            return bytes.toByteArray();
        }
    }

    @Test
    void pairReplacesIncorrectAnswersAndReadbackMatchesTheSavedFiles() throws Exception {
        preparation.attachAnswers("01_Verben_mit_Praepositionen.pdf", pdf(1));
        byte[] workbook = pdf(2), answers = pdf(3);
        var saved = service.prepareMaterials(actor, "pdf-test-event", null,
                "Виталина_Ноябрь_2026-11-05_Рабочий_лист.pdf", workbook,
                "Виталина_Ноябрь_2026-11-05_Ответы_к_уроку.pdf", answers);
        assertThat(saved.success()).isTrue();
        assertThat(saved.hasWorkbook()).isTrue();
        assertThat(saved.hasAnswers()).isTrue();
        assertThat(saved.workbookFilename()).isEqualTo("Виталина_Ноябрь_2026-11-05_Рабочий_лист.pdf");
        assertThat(saved.answersFilename()).isEqualTo("Виталина_Ноябрь_2026-11-05_Ответы_к_уроку.pdf");
        assertThat(saved.workbookVersion()).isEqualTo(1);
        assertThat(saved.answersVersion()).isEqualTo(2);
        assertThat(saved.workbookSizeBytes()).isEqualTo(workbook.length);
        assertThat(saved.answersSizeBytes()).isEqualTo(answers.length);
        assertThat(service.getOrCreate(actor, "pdf-test-event")).isEqualTo(saved);
        verifyNoInteractions(drive);
    }

    @Test
    void replacingOnlyWorkbookPreservesAnswersTranscriptAndUnmentionedNotes() throws Exception {
        byte[] originalAnswers = pdf(1), transcript = pdf(2);
        preparation.attachWorkbook("old.pdf", pdf(1));
        preparation.attachAnswers("answers.pdf", originalAnswers);
        preparation.attachTranscriptPdf("transcript.pdf", transcript);
        preparation.updateNotes("Assigned homework", "Fractions", "Existing plan", "must not replace PDF");
        preparation.updateCoveredMaterial("Existing covered topics");
        var saved = service.prepareMaterials(actor, "pdf-test-event",
                new UpdateLessonPreparationRequest(null, null, "Updated plan", null, null),
                "new.pdf", pdf(3), null, null);
        assertThat(saved.workbookVersion()).isEqualTo(2);
        assertThat(saved.answersVersion()).isEqualTo(1);
        assertThat(saved.homeworkNotes()).isEqualTo("Assigned homework");
        assertThat(saved.difficulties()).isEqualTo("Fractions");
        assertThat(saved.lessonPlan()).isEqualTo("Updated plan");
        assertThat(saved.coveredMaterial()).isEqualTo("Existing covered topics");
        assertThat(preparation.getAnswersPdf()).containsExactly(originalAnswers);
        assertThat(preparation.getTranscriptPdf()).containsExactly(transcript);
        verifyNoInteractions(drive);
    }

    @Test
    void invalidSecondPdfCannotChangeFirstPdfOrNotes() throws Exception {
        byte[] previous = pdf(1);
        preparation.attachWorkbook("previous.pdf", previous);
        preparation.updateNotes("Keep homework", "Keep difficulties", "Keep plan", null);
        assertThatThrownBy(() -> service.prepareMaterials(actor, "pdf-test-event",
                new UpdateLessonPreparationRequest("Changed", "Changed", "Changed", null),
                "replacement.pdf", pdf(2), "renamed.pdf", "JPEG data".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ResponseStatusException.class);
        assertThat(preparation.getWorkbookPdf()).containsExactly(previous);
        assertThat(preparation.getWorkbookVersion()).isEqualTo(1);
        assertThat(preparation.getLessonPlan()).isEqualTo("Keep plan");
        verify(repository, never()).saveAndFlush(any());
        verifyNoInteractions(drive);
    }

    @Test
    void answersOnlyNeverChangesWorkbookAndDoesNotArchiveToDrive() throws Exception {
        byte[] original = pdf(1);
        preparation.attachWorkbook("workbook.pdf", original);
        preparation.attachAnswers("wrong.pdf", pdf(1));
        var saved = service.uploadAnswers(actor, "pdf-test-event", "../../Ответы\n<>.pdf", pdf(2));
        assertThat(saved.answersFilename()).isEqualTo("Ответы.pdf");
        assertThat(saved.answersVersion()).isEqualTo(2);
        assertThat(preparation.getWorkbookPdf()).containsExactly(original);
        assertThat(saved.workbookVersion()).isEqualTo(1);
        verifyNoInteractions(drive);
    }

    @Test
    void notesOnlyCanClearAnExplicitFieldWithoutChangingOtherFields() {
        preparation.updateNotes("Keep homework", "Clear this", "Keep plan", "Keep transcript");
        var saved = service.prepareMaterials(actor, "pdf-test-event",
                new UpdateLessonPreparationRequest(null, "", null, null), null, null, null, null);
        assertThat(saved.difficulties()).isNull();
        assertThat(saved.homeworkNotes()).isEqualTo("Keep homework");
        assertThat(saved.lessonPlan()).isEqualTo("Keep plan");
        assertThat(saved.transcriptText()).isEqualTo("Keep transcript");
    }

    @Test
    void malformedPdfWithHeaderAndEmptyPdfAreRejectedWithoutWrites() {
        for (byte[] invalid : new byte[][]{new byte[0], "%PDF-not-a-real-document".getBytes(StandardCharsets.UTF_8)}) {
            assertThatThrownBy(() -> service.uploadWorkbook(actor, "pdf-test-event", "renamed.pdf", invalid))
                    .isInstanceOf(ResponseStatusException.class);
            assertThatThrownBy(() -> service.uploadAnswers(actor, "pdf-test-event", "renamed.pdf", invalid))
                    .isInstanceOf(ResponseStatusException.class);
        }
        verify(repository, never()).saveAndFlush(any());
        verifyNoInteractions(drive);
    }
}
