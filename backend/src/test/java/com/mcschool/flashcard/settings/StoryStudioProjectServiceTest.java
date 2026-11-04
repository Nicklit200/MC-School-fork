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
import java.util.Map;
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
    private static final String COLLECTION = """
            {"schema":"mindcrafti.story-studio/2","activeTemplateId":"template-2",
             "assets":{"logoSrc":"data:image/webp;base64,YQ==","extraAsset":"keep"},
             "templates":[{"id":"template-1","name":"Новости","story":{"headline_1":"Original","unknown":{"nested":[1,2]}},"css":".news{color:red}","html":"<div>Original</div>"},
                          {"id":"template-2","name":"Результаты","story":{"before":55,"after":70,"custom":"untouched"},"css":".progress{color:green}","html":"<div>Progress</div>"}]}
            """;

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

    @Test void acceptsLegacyVersionAndNamedCollectionWithoutRewritingUnknownFieldsOrOriginalLogo() {
        assertDoesNotThrow(() -> service.validateProject(PROJECT));
        assertDoesNotThrow(() -> service.validateProject(PROJECT.replaceFirst("\\{", "{\"schema\":\"mindcrafti.story-studio/1\",")));
        assertDoesNotThrow(() -> service.validateProject(COLLECTION));
        stored(7, COLLECTION);
        assertEquals(COLLECTION, service.get(admin).get("projectJson"));
        assertArrayEquals(COLLECTION.getBytes(StandardCharsets.UTF_8), service.download(admin, 7));
        assertEquals(StoryStudioProjectService.sha256(COLLECTION.getBytes(StandardCharsets.UTF_8)), service.info(admin).get("sha256"));
    }

    @Test void rejectsMalformedCollectionsWithoutAnyDatabaseMutation() throws Exception {
        for (String invalid : List.of(
                COLLECTION.replace("mindcrafti.story-studio/2", "mindcrafti.story-studio/3"),
                COLLECTION.replace("\"activeTemplateId\":\"template-2\"", "\"activeTemplateId\":\"missing\""),
                COLLECTION.replace("\"id\":\"template-2\"", "\"id\":\"template-1\""),
                COLLECTION.replace("\"id\":\"template-2\"", "\"id\":\"bad/id\""),
                COLLECTION.replace("\"id\":\"template-2\"", "\"id\":\"" + "x".repeat(81) + "\""),
                COLLECTION.replace("\"name\":\"Результаты\"", "\"name\":\"   \""),
                COLLECTION.replace("\"name\":\"Результаты\"", "\"name\":\"" + "x".repeat(81) + "\""),
                COLLECTION.replace("\"name\":\"Результаты\"", "\"name\":\" " + "x".repeat(80) + " \""),
                COLLECTION.replace("\"css\":\".progress{color:green}\"", "\"css\":\" \""),
                COLLECTION.replace("\"html\":\"<div>Progress</div>\"", "\"html\":null"),
                COLLECTION.replace("data:image/webp;base64,YQ==", "https://example.test/logo.webp"))) {
            assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.save(admin, 0, invalid)).getStatusCode().value());
        }
        ObjectMapper json = new ObjectMapper();
        Map<String, Object> parsed = json.readValue(COLLECTION, Map.class);
        parsed.put("templates", List.of());
        assertThrows(ResponseStatusException.class, () -> service.validateProject(json.writeValueAsString(parsed)));
        parsed.put("templates", java.util.Collections.nCopies(21, Map.of("id", "duplicate")));
        assertThrows(ResponseStatusException.class, () -> service.validateProject(json.writeValueAsString(parsed)));
        verifyNoInteractions(jdbc);
    }

    @Test void validCollectionSaveUsesOwnerAndExpectedRevisionAndReturnsOnlyMetadata() {
        stored(4, COLLECTION);
        when(jdbc.update(contains("owner_id = ? AND revision = ?"), eq(COLLECTION), anyString(), eq(admin.id()), eq(3L))).thenReturn(1);
        var result = service.save(admin, 3, COLLECTION);
        assertEquals(4L, result.get("version"));
        assertFalse(result.containsKey("projectJson"));
        verify(jdbc).update(contains("owner_id = ? AND revision = ?"), eq(COLLECTION),
                eq(StoryStudioProjectService.sha256(COLLECTION.getBytes(StandardCharsets.UTF_8))), eq(admin.id()), eq(3L));
    }

    @Test void collectionCannotBypassOverallCharacterOrUtf8ByteBudgets() {
        assertThrows(ResponseStatusException.class, () -> service.validateProject(COLLECTION.replace("untouched", "x".repeat(StoryStudioProjectService.MAX_CHARS))));
        String wide = COLLECTION.replace("untouched", "界".repeat(1_400_000));
        assertTrue(wide.length() < StoryStudioProjectService.MAX_CHARS);
        assertTrue(wide.getBytes(StandardCharsets.UTF_8).length > StoryStudioProjectService.MAX_BYTES);
        assertThrows(ResponseStatusException.class, () -> service.validateProject(wide));
    }
}
