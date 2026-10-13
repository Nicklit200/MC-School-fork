package com.mcschool.flashcard.auth;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

class OnlineClassPilotAuthorizationManagerTest {

    private static final UUID OWNER_ID = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    private static final UUID OTHER_TEACHER_ID = UUID.fromString("0bc65a88-c98f-4598-a7bf-65ed2c5cd443");
    private static final UUID STUDENT_ID = UUID.fromString("8c72f977-2e57-4b3c-8d94-d1b0e3dfdc98");

    private UserRepository users;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
    }

    @Test
    void featureDisabledBlocksEvenOwner() {
        var guard = new OnlineClassPilotAuthorizationManager(users, false, OWNER_ID.toString());
        assertFalse(guard.isAllowed(auth(OWNER_ID, Role.TEACHER)));
    }

    @Test
    void ownerNotConfiguredFailsClosed() {
        var guard = new OnlineClassPilotAuthorizationManager(users, true, "");
        assertFalse(guard.isAllowed(auth(OWNER_ID, Role.TEACHER)));
    }

    @Test
    void onlyDesignatedTeacherCanHost() {
        var guard = enabledGate();
        assertTrue(guard.isAllowed(auth(OWNER_ID, Role.TEACHER)));
        assertFalse(guard.isAllowed(auth(OTHER_TEACHER_ID, Role.TEACHER)));
        assertFalse(guard.isAllowed(auth(OWNER_ID, Role.ADMIN)));
        assertFalse(guard.isAllowed(auth(OWNER_ID, Role.PARENT)));
        assertFalse(guard.isAllowed(null));
    }

    @Test
    void studentCanOnlyAccessPilotClassEndpointsWhenAssignedToPilotTeacher() {
        var guard = enabledGate();
        User student = mock(User.class);
        User owner = mock(User.class);
        when(student.isArchived()).thenReturn(false);
        when(student.getStatus()).thenReturn(UserStatus.ACTIVE);
        when(student.getTeacher()).thenReturn(owner);
        when(owner.getId()).thenReturn(OWNER_ID);
        when(users.findById(STUDENT_ID)).thenReturn(Optional.of(student));

        assertTrue(guard.isAllowed(auth(STUDENT_ID, Role.STUDENT)));
        when(owner.getId()).thenReturn(OTHER_TEACHER_ID);
        assertFalse(guard.isAllowed(auth(STUDENT_ID, Role.STUDENT)));
    }

    @Test
    void archivedStudentCannotBypassAccess() {
        var guard = enabledGate();
        User student = mock(User.class);
        when(student.isArchived()).thenReturn(true);
        when(users.findById(STUDENT_ID)).thenReturn(Optional.of(student));
        assertFalse(guard.isAllowed(auth(STUDENT_ID, Role.STUDENT)));
    }

    @Test
    void unexpectedPrincipalIsRejected() {
        var guard = enabledGate();
        var invalid = UsernamePasswordAuthenticationToken.authenticated("fake-client-id", null, List.of());
        assertFalse(guard.isAllowed(invalid));
    }

    private OnlineClassPilotAuthorizationManager enabledGate() {
        return new OnlineClassPilotAuthorizationManager(users, true, OWNER_ID.toString());
    }

    private Authentication auth(UUID userId, Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedUser(userId, null, role), null, List.of());
    }
}
