package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.*;
import com.mcschool.flashcard.users.*;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class PersonalLessonDocumentServiceTest {
    private final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    private final LessonPreparationRepository shared = mock(LessonPreparationRepository.class);
    private final PersonalLessonWorkbookService personal = mock(PersonalLessonWorkbookService.class);
    private final OnlineClassDocumentService service = new OnlineClassDocumentService(access, shared, personal);
    private User teacher;
    private User student;
    private OnlineClass room;
    private AuthenticatedUser studentCaller;

    @BeforeEach
    void setup() {
        teacher = User.activeTeacher("Nick", "nick@test.local", "nick", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        student = User.managedStudent("Student", teacher);
        studentCaller = new AuthenticatedUser(student.getId(), null, Role.STUDENT);
        room = OnlineClass.forStudent(teacher, "event", "event", "Math", Instant.now(), Instant.now().plusSeconds(3600), student);
        when(access.requireAdmitted(studentCaller, room.getId())).thenReturn(room);
    }

    @Test
    void commonRemainsCommonWhilePersonalDocumentIsIndependent() {
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachWorkbook("shared.pdf", "shared".getBytes());
        when(shared.findByTeacherIdAndEventId(teacher.getId(), "event")).thenReturn(Optional.of(preparation));
        var workbook = PersonalLessonWorkbook.create(teacher.getId(), "event", student.getId());
        workbook.attach("personal.pdf", "personal".getBytes());
        when(personal.workbookForClass(room, student.getId())).thenReturn(Optional.of(workbook));
        assertThat(service.workbook(studentCaller, room.getId(), "board-1")).contains("shared".getBytes());
        assertThat(service.workbook(studentCaller, room.getId(), PersonalBoard.targetIdFor(student.getId())))
                .contains("shared".getBytes());
        assertThat(service.workbook(studentCaller, room.getId(), "personal-workbook-" + student.getId()))
                .contains("personal".getBytes());
    }

    @Test
    void absentPersonalPdfDoesNotFallBackToSharedOnPilotAccount() {
        assertThat(service.workbook(studentCaller, room.getId(), "personal-workbook-" + student.getId())).isEmpty();
        assertThat(service.workbookVersion(studentCaller, room.getId(), "personal-workbook-" + student.getId())).isZero();
        verifyNoInteractions(shared);
    }

    @Test
    void differentStudentCannotReadDocumentOrProbeItsVersion() {
        String otherBoard = "personal-workbook-" + UUID.randomUUID();
        assertThatThrownBy(() -> service.workbook(studentCaller, room.getId(), otherBoard))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.workbookVersion(studentCaller, room.getId(), otherBoard))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(shared, personal);
    }

    @Test
    void waitingRoomCannotReadEitherPdfOrVersion() {
        when(access.requireAdmitted(studentCaller, room.getId())).thenThrow(new ResourceNotFoundException("Not admitted"));
        assertThatThrownBy(() -> service.workbook(studentCaller, room.getId(), "personal-workbook-" + student.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.workbookVersion(studentCaller, room.getId(), "board-1"))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(shared, personal);
    }

    @Test
    void hostMayReadOnlyCurrentStudentsAndVersionUsesSameChecks() {
        var host = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(access.requireAdmitted(host, room.getId())).thenReturn(room);
        when(access.isHost(host, room)).thenReturn(true);
        when(personal.workbookVersionForClass(room, student.getId())).thenReturn(7L);
        assertThat(service.workbookVersion(host, room.getId(), "personal-workbook-" + student.getId())).isEqualTo(7L);
        verify(personal).requireClassStudent(room, student.getId());
        doThrow(new ResourceNotFoundException("No longer enrolled")).when(personal).requireClassStudent(room, student.getId());
        assertThatThrownBy(() -> service.workbook(host, room.getId(), "personal-workbook-" + student.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void nonPilotTeacherKeepsExistingSharedDocumentOnStudentBoard() {
        ReflectionTestUtils.setField(teacher, "id", UUID.randomUUID());
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachWorkbook("shared.pdf", "old-behaviour".getBytes());
        when(shared.findByTeacherIdAndEventId(teacher.getId(), "event")).thenReturn(Optional.of(preparation));
        assertThat(service.workbook(studentCaller, room.getId(), PersonalBoard.targetIdFor(student.getId())))
                .contains("old-behaviour".getBytes());
        assertThat(service.workbookVersion(studentCaller, room.getId(), PersonalBoard.targetIdFor(student.getId()))).isPositive();
        verify(personal, never()).workbookForClass(any(), any());
        assertThatThrownBy(() -> service.workbook(studentCaller, room.getId(), "personal-workbook-" + student.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.workbookVersion(studentCaller, room.getId(), "personal-workbook-" + student.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void invalidBoardIdsAreNotSilentlyTreatedAsShared() {
        assertThatThrownBy(() -> service.workbook(studentCaller, room.getId(), "personal-not-an-id"))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.workbookVersion(studentCaller, room.getId(), "unknown-board"))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
