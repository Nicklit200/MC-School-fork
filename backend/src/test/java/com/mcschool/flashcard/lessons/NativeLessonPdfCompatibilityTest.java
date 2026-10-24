package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayOutputStream;
import java.util.Optional;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/** Native notes must not regress the production PDF upload/append behavior. */
class NativeLessonPdfCompatibilityTest {
    @Test
    void coveredNotesRetainWorkbookAppendAndExplicitAnswerSlots() throws Exception {
        User teacher = User.activeTeacher("Teacher", "native-pdf@test.local", "native-pdf", "unused");
        var caller = new AuthenticatedUser(teacher.getId(), null, teacher.getRole());
        var repository = mock(LessonPreparationRepository.class);
        var preparation = LessonPreparation.create(teacher, "local-pdf");
        preparation.updateCoveredMaterial("Completed work");
        when(repository.findByTeacherIdAndEventId(teacher.getId(), "local-pdf")).thenReturn(Optional.of(preparation));
        when(repository.save(any())).thenAnswer(call -> call.getArgument(0));
        when(repository.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        var service = new LessonPreparationService(repository, mock(UserRepository.class), mock(LessonDriveArchiveService.class));
        byte[] pdf;
        try (var document = new PDDocument(); var bytes = new ByteArrayOutputStream()) {
            document.addPage(new PDPage()); document.save(bytes); pdf = bytes.toByteArray();
        }
        var uploaded = service.uploadWorkbook(caller, "local-pdf", "solutions_for_students.pdf", pdf);
        assertThat(uploaded.hasWorkbook()).isTrue();
        assertThat(uploaded.hasAnswers()).isFalse();
        service.uploadWorkbook(caller, "local-pdf", "__answers__:teacher.pdf", pdf);
        assertThat(preparation.getAnswersFilename()).isEqualTo("teacher.pdf");
        var appended = service.appendWorkbook(caller, "local-pdf", "page-two.pdf", pdf);
        assertThat(appended.coveredMaterial()).isEqualTo("Completed work");
        assertThat(appended.hasAnswers()).isTrue();
        try (var combined = Loader.loadPDF(preparation.getWorkbookPdf())) {
            assertThat(combined.getNumberOfPages()).isEqualTo(2);
        }
        byte[] previous = preparation.getWorkbookPdf();
        assertThatThrownBy(() -> service.appendWorkbook(caller, "local-pdf", "broken.pdf", "%PDF-invalid".getBytes()))
                .isInstanceOf(ResponseStatusException.class);
        assertThat(preparation.getWorkbookPdf()).containsExactly(previous);
    }
}
