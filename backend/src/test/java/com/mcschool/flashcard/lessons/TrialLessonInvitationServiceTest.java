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
    private final JwtService jwt = mock(JwtService.class);
    private final TrialLessonInvitationService service =
            new TrialLessonInvitationService(jdbc, lessons, classes, rooms, users, manual, jwt);

    @Test
    void onlyNativeTeacherOwnedTrialsCanIssueLinks() {
        assertThrows(ResourceNotFoundException.class,
                () -> service.issue(new AuthenticatedUser(UUID.randomUUID(), "teacher@test", Role.STUDENT),
                        "local-" + UUID.randomUUID()));
        assertThrows(ResourceNotFoundException.class,
                () -> service.issue(new AuthenticatedUser(UUID.randomUUID(), "teacher@test", Role.TEACHER),
                        "google-calendar-event"));
        verifyNoInteractions(lessons, classes, rooms, users, manual, jwt, jdbc);
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
