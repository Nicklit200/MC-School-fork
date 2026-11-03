package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

/** Creating a blank lesson archive must not let arbitrary events acquire preparations. */
class CompletedLessonArchivePreparationTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final LessonPreparationService lessons = mock(LessonPreparationService.class);
    private final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    private final PersonalLessonWorkbookService personal = mock(PersonalLessonWorkbookService.class);
    private final CompletedLessonDocumentController controller = new CompletedLessonDocumentController(jdbc, lessons, access, personal);
    private final User owner = User.activeTeacher("Owner", "owner@archive.test", "owner", "unused");
    private final AuthenticatedUser caller = new AuthenticatedUser(owner.getId(), null, Role.TEACHER);
    private final UUID classId = UUID.randomUUID();
    private static final String EVENT = "owned-event";

    private MockMultipartFile pdf() {
        return new MockMultipartFile("file", "completed.pdf", "application/pdf", "%PDF-archive".getBytes());
    }

    @Test
    void createsMissingPreparationOnlyAfterOwnedClassAndPdfValidation() throws Exception {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(classId), eq(caller.id()), eq(EVENT))).thenReturn(1);
        var saved = new CompletedLessonDocumentController.DocumentInfo(UUID.randomUUID(), classId, "board-1", "finished.pdf", "now");
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<CompletedLessonDocumentController.DocumentInfo>>any(),
                eq(caller.id()), eq(EVENT))).thenReturn(List.of(saved));
        AtomicBoolean preparationExists = new AtomicBoolean();
        when(lessons.getOrCreate(caller, EVENT)).thenAnswer(invocation -> { preparationExists.set(true); return null; });
        when(lessons.require(caller, EVENT)).thenAnswer(invocation -> {
            if (!preparationExists.get()) throw new ResourceNotFoundException("No preparation yet");
            return LessonPreparation.create(owner, EVENT);
        });

        assertThat(controller.save(caller, EVENT, classId, "board-1", pdf())).isEqualTo(saved);
        var ordered = inOrder(jdbc, lessons);
        ordered.verify(jdbc).queryForObject(anyString(), eq(Integer.class), eq(classId), eq(caller.id()), eq(EVENT));
        ordered.verify(lessons).getOrCreate(caller, EVENT);
        ordered.verify(jdbc).update(anyString(), any(UUID.class), eq(caller.id()), eq(EVENT), eq(classId),
                eq("board-1"), eq("Общая-доска.pdf"), any(byte[].class));
        ordered.verify(lessons).require(caller, EVENT);
        verifyNoInteractions(access, personal);
    }

    @Test
    void missingForeignOrMismatchedClassDoesNotCreatePreparation() {
        for (String eventId : List.of(EVENT, "another-event")) {
            assertThatThrownBy(() -> controller.save(caller, eventId, classId, "board-1", pdf()))
                    .isInstanceOfSatisfying(ResponseStatusException.class,
                            error -> assertThat(error.getStatusCode().value()).isEqualTo(403));
        }
        verifyNoInteractions(lessons, access, personal);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void invalidBoardOrPdfCannotCreatePreparationOrWriteArchive() {
        assertThatThrownBy(() -> controller.save(caller, EVENT, classId, "not-a-board", pdf()))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.save(caller, EVENT, classId, "board-1",
                new MockMultipartFile("file", "empty.pdf", "application/pdf", new byte[0])))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.save(caller, EVENT, classId, "board-1",
                new MockMultipartFile("file", "wrong.pdf", "application/pdf", "plain-text".getBytes())))
                .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(lessons, jdbc, access, personal);
    }

    @Test
    void revokedPrivateTargetCannotCreatePreparationEvenWhenCallerOwnsClass() {
        User student = User.managedStudent("Student", owner);
        OnlineClass room = OnlineClass.forStudent(owner, EVENT, EVENT, "Math", Instant.now(), Instant.now().plusSeconds(3600), student);
        when(access.requireHost(caller, room.getId())).thenReturn(room);
        when(personal.enabled(caller)).thenReturn(true);
        doThrow(new ResourceNotFoundException("Removed pupil")).when(personal).requireClassStudent(room, student.getId());
        assertThatThrownBy(() -> controller.save(caller, EVENT, room.getId(), PersonalBoard.workbookTargetIdFor(student.getId()), pdf()))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(lessons, jdbc);
    }

    @Test
    void readsNeverCreatePreparationForAnUnknownEvent() {
        when(lessons.require(caller, EVENT)).thenThrow(new ResourceNotFoundException("No preparation"));
        assertThatThrownBy(() -> controller.list(caller, EVENT)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> controller.download(caller, EVENT, UUID.randomUUID())).isInstanceOf(ResourceNotFoundException.class);
        verify(lessons, never()).getOrCreate(any(), anyString());
        verifyNoInteractions(jdbc, access, personal);
    }
}
