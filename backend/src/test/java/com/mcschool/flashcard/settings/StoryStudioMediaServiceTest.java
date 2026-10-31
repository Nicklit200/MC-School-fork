package com.mcschool.flashcard.settings;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

class StoryStudioMediaServiceTest {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    StoryStudioMediaService service = new StoryStudioMediaService(jdbc, "test-signing-secret", "https://mindcrafti.de/");
    AuthenticatedUser admin = new AuthenticatedUser(UUID.randomUUID(), "admin@example.test", Role.ADMIN);

    private byte[] png() throws Exception {
        BufferedImage image = new BufferedImage(1080, 1920, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(image, "png", bytes));
        return bytes.toByteArray();
    }

    @Test void acceptsValidInstagramPngAndRejectsWrongDimensions() throws Exception {
        StoryStudioMediaService.validatePng(png());
        BufferedImage image = new BufferedImage(1080, 1919, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> StoryStudioMediaService.validatePng(bytes.toByteArray())).getStatusCode().value());
    }

    @Test void rejectsNonAdminWithoutAccessingDatabase() throws Exception {
        var teacher = new AuthenticatedUser(UUID.randomUUID(), "teacher@example.test", Role.TEACHER);
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> service.upload(teacher, 1, 1, Base64.getEncoder().encodeToString(png()))).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    @Test void acceptsCurrentProjectVersionAndReturnsSignedUrl() throws Exception {
        when(jdbc.query(contains("SELECT revision"), any(RowMapper.class), eq(admin.id()))).thenReturn(List.of(3L));
        var result = service.upload(admin, 3, 2, Base64.getEncoder().encodeToString(png()));
        assertEquals(2, result.get("storyNumber"));
        assertEquals(3L, result.get("studioVersion"));
        assertTrue(((String) result.get("mediaUrl")).startsWith("https://mindcrafti.de/api/v1/public/stories/media/"));
        verify(jdbc).update(startsWith("INSERT INTO story_studio_media"), any(), eq(admin.id()), eq(3L),
                eq(2), anyString(), any(byte[].class), any(java.sql.Timestamp.class));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    @Test void mismatchedStudioVersionIsConflict() throws Exception {
        when(jdbc.query(contains("SELECT revision"), any(RowMapper.class), eq(admin.id()))).thenReturn(List.of(4L));
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> service.upload(admin, 3, 1, Base64.getEncoder().encodeToString(png()))).getStatusCode().value());
    }

    @Test void invalidSignatureIsRejectedBeforeDatabaseAccess() {
        assertEquals(404, assertThrows(ResponseStatusException.class, () ->
                service.validatedDownload(UUID.randomUUID(), Instant.now().plusSeconds(60).getEpochSecond(),
                        "invalid")).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }
}
