package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import com.mcschool.flashcard.liveclasses.PersonalBoard;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

class CompletedPersonalWorkbookDocumentTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final LessonPreparationService lessons = mock(LessonPreparationService.class);
    private final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    private final PersonalLessonWorkbookService personal = mock(PersonalLessonWorkbookService.class);
    private final CompletedLessonDocumentController controller =
            new CompletedLessonDocumentController(jdbc, lessons, access, personal);
    private AuthenticatedUser teacher;
    private OnlineClass room;
    private User student;

    @BeforeEach
    void setup() {
        User owner = User.activeTeacher("Nick", "nick@worksheet.test", "nick", "unused");
        ReflectionTestUtils.setField(owner, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        teacher = new AuthenticatedUser(owner.getId(), owner.getEmail(), Role.TEACHER);
        student = User.managedStudent("Student", owner);
        room = OnlineClass.forStudent(owner, "event", "event", "Math", Instant.now(), Instant.now().plusSeconds(3600), student);
        when(access.requireHost(teacher, room.getId())).thenReturn(room);
        when(personal.enabled(teacher)).thenReturn(true);
    }

    private MockMultipartFile pdf() {
        return new MockMultipartFile("file", "finished.pdf", "application/pdf", "%PDF-test".getBytes());
    }

    private void savedRow(String boardId) {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(room.getId()), eq(teacher.id()), eq("event")))
                .thenReturn(1);
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<CompletedLessonDocumentController.DocumentInfo>>any(),
                eq(teacher.id()), eq("event")))
                .thenReturn(List.of(new CompletedLessonDocumentController.DocumentInfo(
                        UUID.randomUUID(), room.getId(), boardId, "finished.pdf", Instant.now().toString())));
    }

    @Test
    void worksheetExportUsesItsOwnBoardIdentityAndChecksCurrentStudent() throws Exception {
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        savedRow(board);
        var result = controller.save(teacher, "event", room.getId(), board, pdf());
        assertThat(result.boardId()).isEqualTo(board);
        verify(personal).requireClassStudent(room, student.getId());
        verify(jdbc).update(anyString(), any(UUID.class), eq(teacher.id()), eq("event"), eq(room.getId()),
                eq(board), eq("Персональный-лист-" + student.getId() + ".pdf"), any(byte[].class));
    }

    @Test
    void worksheetExportIsDeniedOutsidePilotAndForAnotherLesson() {
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        when(personal.enabled(teacher)).thenReturn(false);
        assertThatThrownBy(() -> controller.save(teacher, "event", room.getId(), board, pdf()))
                .isInstanceOf(ResourceNotFoundException.class);
        when(personal.enabled(teacher)).thenReturn(true);
        assertThatThrownBy(() -> controller.save(teacher, "another-event", room.getId(), board, pdf()))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(jdbc);
    }

    @Test
    void removedOrUnassignedStudentCannotReceiveAnArchivedWorksheet() {
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        doThrow(new ResourceNotFoundException("Student no longer assigned"))
                .when(personal).requireClassStudent(room, student.getId());
        assertThatThrownBy(() -> controller.save(teacher, "event", room.getId(), board, pdf()))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(jdbc);
    }

    @Test
    void normalSharedExportDoesNotRequirePilotAccess() throws Exception {
        savedRow("board-1");
        var result = controller.save(teacher, "event", room.getId(), "board-1", pdf());
        assertThat(result.boardId()).isEqualTo("board-1");
        verifyNoInteractions(access, personal);
    }
}
