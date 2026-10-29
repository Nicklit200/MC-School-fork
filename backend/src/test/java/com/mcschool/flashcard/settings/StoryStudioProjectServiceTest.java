package com.mcschool.flashcard.settings;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class StoryStudioProjectServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuthenticatedUser admin = new AuthenticatedUser(UUID.randomUUID(), "admin@example.test", Role.ADMIN);
    private StoryStudioProjectService service;
    private static final String PROJECT = "{\"story\":{\"headline_1\":\"Новости\"},\"css\":\".story{color:#123}\",\"html\":\"<div>{{headline_1}}</div>\",\"assets\":{\"logoSrc\":\"data:image/webp;base64,YQ==\"}}";

    @BeforeEach void setup() { service = new StoryStudioProjectService(jdbc, new ObjectMapper()); }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stored(long version, String json) {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(admin.id()))).thenReturn(List.of(
                new StoryStudioProjectService.Stored(version, json,
                        StoryStudioProjectService.sha256(json.getBytes(StandardCharsets.UTF_8)), Instant.parse("2026-10-29T10:00:00Z"))));
    }

    @Test void refusesTeacherAndAnonymousBeforeDatabaseAccess() {
        var teacher = new AuthenticatedUser(UUID.randomUUID(), "teacher@example.test", Role.TEACHER);
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> service.info(teacher)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> service.get(null)).getStatusCode().value());
        assertThrows(ResponseStatusException.class, () -> service.save(teacher, 0, PROJECT));
        verifyNoInteractions(jdbc);
    }

    @Test void reportsMissingStudioWithoutInventingTemplate() {
        var info = service.info(admin);
        assertEquals(false, info.get("configured"));
        assertEquals(0L, info.get("version"));
        assertNull(info.get("sha256"));
        assertEquals("MINDCRAFTI_STUDIO_PROJECT_JSON", info.get("format"));
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.download(admin, 0)).getStatusCode().value());
    }

    @Test void validatesRealEditorDocumentAndOriginalEmbeddedLogo() {
        assertDoesNotThrow(() -> service.validateProject(PROJECT));
        for (String invalid : List.of("{}", "[]", "not json", PROJECT.replace("data:image/webp;base64,YQ==", "https://example.test/logo.png"),
                PROJECT.replace("\"story\":{\"headline_1\":\"Новости\"}", "\"story\":[]"))) {
            assertThrows(ResponseStatusException.class, () -> service.validateProject(invalid));
        }
        assertThrows(ResponseStatusException.class, () -> service.validateProject(null));
        assertThrows(ResponseStatusException.class, () -> service.validateProject("x".repeat(StoryStudioProjectService.MAX_CHARS + 1)));
    }

    @Test void missingVersionAndInvalidChunkAreRejected() {
        stored(4, PROJECT);
        assertEquals(409, assertThrows(ResponseStatusException.class, () -> service.chunk(admin, 3, 0)).getStatusCode().value());
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.chunk(admin, 4, -1)).getStatusCode().value());
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.chunk(admin, 4, 1)).getStatusCode().value());
    }

    @Test void exactUtf8BytesAreDownloadableAndHashMatches() {
        stored(4, PROJECT);
        byte[] bytes = PROJECT.getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(bytes, service.download(admin, 4));
        var chunk = service.chunk(admin, 4, 0);
        assertArrayEquals(bytes, Base64.getDecoder().decode((String) chunk.get("base64")));
        assertEquals(StoryStudioProjectService.sha256(bytes), chunk.get("sha256"));
        assertEquals(4L, chunk.get("version"));
        assertEquals(PROJECT, service.get(admin).get("projectJson"));
    }

    @Test void multipleChunksReconstructExactDocument() {
        String large = PROJECT.replace("Новости", "Новости".repeat(15000));
        stored(7, large);
        var out = new java.io.ByteArrayOutputStream();
        int count = (Integer) service.info(admin).get("chunkCount");
        assertTrue(count > 1);
        for (int i = 0; i < count; i++) {
            var part = service.chunk(admin, 7, i);
            out.writeBytes(Base64.getDecoder().decode((String) part.get("base64")));
        }
        assertArrayEquals(large.getBytes(StandardCharsets.UTF_8), out.toByteArray());
    }

    @Test void insertAndUpdateConflictsNeverBlindlyOverwrite() {
        assertEquals(409, assertThrows(ResponseStatusException.class, () -> service.save(admin, 0, PROJECT)).getStatusCode().value());
        assertEquals(409, assertThrows(ResponseStatusException.class, () -> service.save(admin, 3, PROJECT)).getStatusCode().value());
        verify(jdbc).update(contains("ON CONFLICT (owner_id) DO NOTHING"), eq(admin.id()), eq(PROJECT), anyString());
        verify(jdbc).update(contains("owner_id = ? AND revision = ?"), eq(PROJECT), anyString(), eq(admin.id()), eq(3L));
    }

    @Test void anotherAdminCannotReadTheStoredProject() {
        stored(4, PROJECT);
        var other = new AuthenticatedUser(UUID.randomUUID(), "other@example.test", Role.ADMIN);
        assertEquals(false, service.info(other).get("configured"));
        assertThrows(ResponseStatusException.class, () -> service.download(other, 4));
    }

    @Test void negativeRevisionRejectedBeforeMutation() {
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.save(admin, -1, PROJECT)).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }
}
