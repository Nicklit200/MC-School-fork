package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class CoveredMaterialServiceTest {
    private final LessonPreparationRepository repository = mock(LessonPreparationRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final LessonDriveArchiveService drive = mock(LessonDriveArchiveService.class);
    private final LessonPreparationService service = new LessonPreparationService(repository, users, drive);
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "unused");
    private final AuthenticatedUser caller = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.TEACHER);
    private final LessonPreparation preparation = LessonPreparation.create(teacher, "local-test");

    @BeforeEach
    void setUp() {
        when(repository.findByTeacherIdAndEventId(teacher.getId(), "local-test")).thenReturn(Optional.of(preparation));
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        preparation.updateNotes("Homework", "Difficulties", "Plan", "Transcript");
        preparation.attachWorkbook("workbook.pdf", new byte[] {1, 2});
    }

    @Test
    void savesAndReadsCoveredMaterialWithoutChangingOtherFieldsOrDocuments() {
        var result = service.update(caller, "local-test", new UpdateLessonPreparationRequest(
                "Homework", "Difficulties", "Plan", "Transcript", "  Fractions: exercises 1–5  "));
        assertThat(result.coveredMaterial()).isEqualTo("Fractions: exercises 1–5");
        assertThat(service.getOrCreate(caller, "local-test").coveredMaterial()).isEqualTo(result.coveredMaterial());
        assertThat(result.homeworkNotes()).isEqualTo("Homework");
        assertThat(result.difficulties()).isEqualTo("Difficulties");
        assertThat(result.lessonPlan()).isEqualTo("Plan");
        assertThat(result.transcriptText()).isEqualTo("Transcript");
        assertThat(result.hasWorkbook()).isTrue();
        assertThat(preparation.getWorkbookPdf()).containsExactly((byte) 1, (byte) 2);
        verifyNoInteractions(drive);
    }

    @Test
    void olderJsonClientsAndIntegrationsPreserveExistingCoveredMaterial() {
        preparation.updateCoveredMaterial("Completed work");
        var oldJson = new ObjectMapper().readValue("""
                {"homeworkNotes":"New homework","difficulties":"Difficulties","lessonPlan":"Plan","transcriptText":"Transcript"}
                """, UpdateLessonPreparationRequest.class);
        assertThat(service.update(caller, "local-test", oldJson).coveredMaterial()).isEqualTo("Completed work");
        var oldConstructor = new UpdateLessonPreparationRequest("Homework", "Difficulties", "Plan", "Transcript");
        assertThat(service.update(caller, "local-test", oldConstructor).coveredMaterial()).isEqualTo("Completed work");
    }

    @Test
    void explicitlyEmptyTextClearsCoveredMaterial() {
        preparation.updateCoveredMaterial("Completed work");
        var result = service.update(caller, "local-test", new UpdateLessonPreparationRequest(
                "Homework", "Difficulties", "Plan", "Transcript", "   "));
        assertThat(result.coveredMaterial()).isNull();
        assertThat(preparation.getLessonPlan()).isEqualTo("Plan");
    }
}
