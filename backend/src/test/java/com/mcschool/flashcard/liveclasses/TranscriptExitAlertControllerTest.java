package com.mcschool.flashcard.liveclasses;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The real classroom button API routes both enqueue the server-side audit. */
class TranscriptExitAlertControllerTest {
    private OnlineClassService classes;
    private TranscriptExitAlertService alerts;
    private OnlineClassController controller;
    private AuthenticatedUser teacher;
    private UUID classId;

    @BeforeEach
    void setUp() {
        classes = mock(OnlineClassService.class);
        alerts = mock(TranscriptExitAlertService.class);
        controller = new OnlineClassController(
                classes,
                mock(OnlineClassAdmissionService.class),
                mock(OnlineClassHostControlService.class),
                mock(OnlineClassChatService.class),
                mock(OnlineClassRecordingService.class),
                mock(OnlineClassTranscriptService.class),
                mock(OnlineClassAnnotationService.class));
        controller.installTranscriptExitAlerts(alerts);
        teacher = new AuthenticatedUser(UUID.randomUUID(), "teacher@test.local", Role.TEACHER);
        classId = UUID.randomUUID();
    }

    @Test
    void teacherExitQueuesAudit() {
        controller.leave(teacher, classId);
        verify(classes).leave(teacher, classId);
        verify(alerts).scheduleForHost(teacher.id(), classId);
    }

    @Test
    void teacherEndForAllQueuesAudit() {
        controller.end(teacher, classId);
        verify(classes).end(teacher, classId);
        verify(alerts).scheduleForHost(teacher.id(), classId);
    }
}
