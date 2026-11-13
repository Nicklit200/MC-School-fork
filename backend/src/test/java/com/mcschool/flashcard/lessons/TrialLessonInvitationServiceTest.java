package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.JwtService;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import com.mcschool.flashcard.common.ResourceNotFoundException;

class TrialLessonInvitationServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final LessonHistoryRepository lessons = mock(LessonHistoryRepository.class);
    private final OnlineClassService classes = mock(OnlineClassService.class);
    private final OnlineClassRepository rooms = mock(OnlineClassRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final ManualLessonService manual = mock(ManualLessonService.class);
    private final GoogleCalendarLessonService calendar = mock(GoogleCalendarLessonService.class);
    private final JwtService jwt = mock(JwtService.class);
    private final TrialLessonInvitationService service =
            new TrialLessonInvitationService(jdbc, lessons, classes, rooms, users, manual, calendar, jwt);

    @Test
    void onlyTeacherOwnedLessonsCanIssueLinks() {
        assertThrows(ResourceNotFoundException.class,
                () -> service.issue(new AuthenticatedUser(UUID.randomUUID(), "teacher@test", Role.STUDENT),
                        "local-" + UUID.randomUUID()));
        assertThrows(ResourceNotFoundException.class,
                () -> service.issue(new AuthenticatedUser(UUID.randomUUID(), "teacher@test", Role.TEACHER),
                        "google-calendar-event"));
        verify(lessons).findByTeacherIdAndEventId(any(), eq("google-calendar-event"));
        verifyNoInteractions(classes, rooms, users, manual, calendar, jwt, jdbc);
    }

    @Test
    void flushesNewClassroomBeforeInsertingInvitationWithForeignKey() {
        UUID teacherId = UUID.randomUUID();
        UUID classId = UUID.randomUUID();
        String eventId = "local-" + UUID.randomUUID();
        User teacher = mock(User.class);
        LessonHistoryEntry lesson = mock(LessonHistoryEntry.class);
        com.mcschool.flashcard.liveclasses.OnlineClass classroom =
                mock(com.mcschool.flashcard.liveclasses.OnlineClass.class);
        var caller = new AuthenticatedUser(teacherId, "teacher@test", Role.TEACHER);
        var classInfo = mock(com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse.class);

        when(lessons.findByTeacherIdAndEventId(teacherId, eventId))
                .thenReturn(java.util.Optional.of(lesson));
        when(classes.materializeFromCalendar(caller, eventId)).thenReturn(classInfo);
        when(classInfo.id()).thenReturn(classId);
        when(rooms.findById(classId)).thenReturn(java.util.Optional.of(classroom));
        when(classroom.getId()).thenReturn(classId);
        when(jwt.trialInvitationToken(teacherId, eventId, classId)).thenReturn("test-token");
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        var created = service.issue(caller, eventId);
        assertEquals(classId, created.classId());
        var inOrder = inOrder(rooms, jdbc);
        inOrder.verify(rooms).flush();
        inOrder.verify(jdbc).update(anyString(), any(Object[].class));
    }

    @Test
    void rejectInvalidGuestNamesBeforeTouchingInvitation() {
        for (String name : new String[]{ "", " ", "A", "A\nB", "X".repeat(81) }) {
            var err = assertThrows(ResponseStatusException.class, () -> service.claim("ignored", name));
            assertEquals(HttpStatus.BAD_REQUEST, err.getStatusCode());
        }
        verifyNoInteractions(jdbc, lessons, users, manual, classes, rooms, jwt);
    }

    @Test
    void rejectsMissingAndIncorrectlyShapedLinksWithoutAccountCreation() {
        assertThrows(ResourceNotFoundException.class, () -> service.info("small"));
        assertThrows(ResourceNotFoundException.class, () -> service.claim("broken-link", "Guest"));
        verifyNoInteractions(users, manual, classes, rooms, jwt);
    }
}
