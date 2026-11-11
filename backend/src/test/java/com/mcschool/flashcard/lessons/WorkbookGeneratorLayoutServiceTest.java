package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class WorkbookGeneratorLayoutServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final WorkbookStudioProjectService owner = mock(WorkbookStudioProjectService.class);
    private final WorkbookGeneratorLayoutService service =
            new WorkbookGeneratorLayoutService(jdbc, new ObjectMapper(), owner);
    private final AuthenticatedUser admin = new AuthenticatedUser(UUID.randomUUID(), "owner@school.test", Role.ADMIN);

    @Test
    void validatedDefaultLayoutIsStableAndAllowsExactRanges() {
        assertDoesNotThrow(() -> WorkbookGeneratorLayoutService.validate(WorkbookGeneratorLayoutService.DEFAULT_JSON));
        var custom = WorkbookGeneratorLayoutService.DEFAULT_JSON
                .replace("\"graphHeightMm\":68", "\"graphHeightMm\":85")
                .replace("\"graphAlignment\":\"center\"", "\"graphAlignment\":\"left\"")
                .replace("\"answerSpacePercent\":100", "\"answerSpacePercent\":60");
        assertDoesNotThrow(() -> WorkbookGeneratorLayoutService.validate(custom));
    }

    @Test
    void rejectsUntrustedCodeUnknownFieldsAndInvalidPhysicalLimits() {
        var defaultJson = WorkbookGeneratorLayoutService.DEFAULT_JSON;
        for (String wrong : new String[] {
                "Write-Host 'run powershell'",
                "{}",
                defaultJson.replace("\"graphHeightMm\":68", "\"graphHeightMm\":160"),
                defaultJson.replace("\"graphWidthPercent\":100", "\"graphWidthPercent\":110"),
                defaultJson.replace("\"graphAlignment\":\"center\"", "\"graphAlignment\":\"right\""),
                defaultJson.replace("\"graphAlignment\":\"center\"",
                        "\"graphAlignment\":\"center\",\"customJs\":\"alert(1)\""),
                defaultJson.replace("\"schema\":\"mindcrafti.generator-layout/1\"",
                        "\"schema\":\"mindcrafti.generator-layout/3\"") }) {
            var ex = assertThrows(ResponseStatusException.class,
                    () -> WorkbookGeneratorLayoutService.validate(wrong));
            assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        }
    }

    @Test
    void unauthorizedOrStaleDraftSaveNeverPassesDatabaseUpdate() {
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(owner).requireOwner(admin);
        assertThrows(ResponseStatusException.class, () ->
                service.saveDraft(admin, 0, WorkbookGeneratorLayoutService.DEFAULT_JSON));
        verifyNoInteractions(jdbc);
    }

    @Test
    void revisedDraftRequiresSuccessfulRenderedPdfBeforeActivation() {
        // No TEST call occurred, so UPDATE ... tested_revision = draft_revision matches no rows.
        when(jdbc.update(contains("SET previous_active_json"), any(), any())).thenReturn(0);
        var ex = assertThrows(ResponseStatusException.class, () -> service.activate(admin, 5, 2));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
        verify(jdbc).update(contains("SET previous_active_json"), eq(5L), eq(2L));
    }
}
