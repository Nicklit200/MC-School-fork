package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class PostLessonHomeworkPilotAccessTest {
    static final UUID NICK=UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    static final UUID OTHER=UUID.fromString("956688de-5022-438d-a86e-c780ee30921d");

    @Test void privatePilotIsAvailableForExactlyOneAccount() {
        var access=new PostLessonHomeworkPilotAccess(NICK.toString());
        assertTrue(access.allowed(NICK));
        assertFalse(access.allowed(OTHER));
        assertDoesNotThrow(()->access.require(new AuthenticatedUser(NICK,null,Role.TEACHER)));
        assertThrows(ResponseStatusException.class,
                ()->access.require(new AuthenticatedUser(OTHER,null,Role.TEACHER)));
        assertThrows(ResponseStatusException.class,()->access.require(OTHER));
    }

    @Test void allTeachersRolloutAllowsOnlyTeacherRoles() {
        var access = new PostLessonHomeworkPilotAccess("ALL");
        assertTrue(access.allTeachersEnabled());
        assertTrue(access.enabled());
        assertNull(access.teacherId());
        assertTrue(access.allowed(NICK));
        assertTrue(access.allowed(OTHER));
        assertDoesNotThrow(() -> access.require(new AuthenticatedUser(OTHER, null, Role.TEACHER)));
        assertThrows(ResponseStatusException.class,
                () -> access.require(new AuthenticatedUser(OTHER, null, Role.STUDENT)));
        assertThrows(ResponseStatusException.class,
                () -> access.require(new AuthenticatedUser(OTHER, null, Role.PARENT)));
    }

    @Test void missingOrMalformedConfigFailsClosed() {
        var empty=new PostLessonHomeworkPilotAccess("");
        var malformed=new PostLessonHomeworkPilotAccess("not-a-uuid");
        assertNull(empty.teacherId());
        assertFalse(empty.allowed(NICK));
        assertFalse(malformed.allowed(NICK));
        assertThrows(ResponseStatusException.class,()->empty.require(NICK));
        assertThrows(ResponseStatusException.class,()->malformed.require(NICK));
    }
}
