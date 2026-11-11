package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class WorkbookStudioProjectServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final Environment environment = mock(Environment.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final WorkbookStudioProjectService service = new WorkbookStudioProjectService(jdbc, mapper, environment);

    private static AuthenticatedUser account(String email, Role role) {
        return new AuthenticatedUser(UUID.randomUUID(), email, role);
    }

    @Test
    void refusesTeachersOtherAdminsAndUnconfiguredOwnerWithoutDatabaseReads() {
        when(environment.getProperty("ADMIN_EMAIL", "")).thenReturn("owner@mindcrafti.test");
        for (var caller : List.of(account("teacher@mindcrafti.test", Role.TEACHER),
                account("other@mindcrafti.test", Role.ADMIN))) {
            var error = assertThrows(ResponseStatusException.class, () -> service.get(caller));
            assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        }
        when(environment.getProperty("ADMIN_EMAIL", "")).thenReturn("");
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> service.get(account("owner@mindcrafti.test", Role.ADMIN))).getStatusCode());
        verifyNoInteractions(jdbc);
    }

    @Test
    void ownerEmailIsCaseInsensitiveAndRequiresAdminRole() {
        when(environment.getProperty("ADMIN_EMAIL", "")).thenReturn("OWNER@mindcrafti.test");
        assertDoesNotThrow(() -> service.requireOwner(account("owner@mindcrafti.test", Role.ADMIN)));
        assertThrows(ResponseStatusException.class,
                () -> service.requireOwner(account("owner@mindcrafti.test", Role.TEACHER)));
    }

    @Test
    void rejectsTeacherOnlyBlockInStudentPages() throws Exception {
        var doc = Map.of(
                "meta", Map.of("school", "MINDCRAFTI SCHOOL", "durationMinutes", 60),
                "workbookPages", List.of(Map.of("blocks", List.of(Map.of("type", "teacherNote")))),
                "teacherPages", List.of(Map.of("blocks", List.of(Map.of("type", "teacherNote")))));
        var project = Map.of("schema", "mindcrafti.workbook-studio/1",
                "activeTemplateId", "one",
                "templates", List.of(Map.of("id", "one", "name", "Math", "document", doc)));
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> service.validateProject(mapper.writeValueAsString(project))).getStatusCode());
    }

    @Test
    void acceptsVersionedTemplateCollectionWithoutCallingProvider() throws Exception {
        var doc = Map.of(
                "meta", Map.of("school", "MINDCRAFTI SCHOOL", "durationMinutes", 60),
                "workbookPages", List.of(Map.of("blocks", List.of(Map.of("type", "exercise",
                        "rows", List.of(Map.of("math", List.of("1", "+", "1"))))))),
                "teacherPages", List.of(Map.of("blocks", List.of(Map.of("type", "solutions",
                        "items", List.of(Map.of("label", "1", "math", List.of("1", "+", "1", "=", "2"))))))));
        var project = Map.of("schema", "mindcrafti.workbook-studio/1", "activeTemplateId", "one",
                "templates", List.of(Map.of("id", "one", "name", "Math", "document", doc)));
        assertDoesNotThrow(() -> service.validateProject(mapper.writeValueAsString(project)));
        verifyNoInteractions(jdbc);
    }
}
