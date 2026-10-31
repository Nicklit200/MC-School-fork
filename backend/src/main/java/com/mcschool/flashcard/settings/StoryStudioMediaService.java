package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stores rendered Instagram Stories for the signed-in administrator.
 * Media are private in PostgreSQL and become downloadable to Metricool only through
 * a tamper-proof, time-limited HTTPS URL. No Instagram or Metricool token is stored here.
 */
@Service
public class StoryStudioMediaService {
    static final int MAX_PNG_BYTES = 3 * 1024 * 1024;
    static final int MAX_BASE64_CHARS = ((MAX_PNG_BYTES + 2) / 3) * 4;
    private static final int WIDTH = 1080;
    private static final int HEIGHT = 1920;
    private static final Duration RETENTION = Duration.ofDays(60);
    private static final byte[] PNG_HEADER = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};

    private final JdbcTemplate jdbc;
    private final byte[] key;
    private final String publicBaseUrl;

    public StoryStudioMediaService(JdbcTemplate jdbc,
            @Value("${app.security.jwt.secret}") String jwtSecret,
            @Value("${PUBLIC_BASE_URL:${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.key = jwtSecret.getBytes(StandardCharsets.UTF_8);
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    record MediaRecord(UUID id, int storyNumber, long studioVersion, String sha256, Instant expiresAt) {}
    public record PngAsset(byte[] bytes) {}

    private static void requireAdmin(AuthenticatedUser user) {
        if (user == null || user.id() == null || user.role() != Role.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Administrator access required");
        }
    }

    @Transactional
    public Map<String, Object> upload(AuthenticatedUser user, long studioVersion, int storyNumber, String imageBase64) {
        requireAdmin(user);
        if (studioVersion < 1 || storyNumber < 1 || storyNumber > 3) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Studio version or Story number");
        }
        if (imageBase64 == null || imageBase64.isBlank() || imageBase64.length() > MAX_BASE64_CHARS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PNG exceeds 3 MB");
        }
        byte[] png;
        try { png = Base64.getDecoder().decode(imageBase64); }
        catch (IllegalArgumentException invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected raw base64 PNG");
        }
        validatePng(png);
        List<Long> versions = jdbc.query("SELECT revision FROM story_studio_projects WHERE owner_id = ?",
                (rs, row) -> rs.getLong("revision"), user.id());
        if (versions.isEmpty() || versions.get(0) != studioVersion) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Studio version changed; reload project before uploading");
        }

        // Expired images do not accumulate forever; a maintenance job can also run this cleanup.
        jdbc.update("DELETE FROM story_studio_media WHERE expires_at < CURRENT_TIMESTAMP");
        UUID id = UUID.randomUUID();
        Instant expiresAt = Instant.now().plus(RETENTION);
        String sha256 = StoryStudioProjectService.sha256(png);
        jdbc.update("INSERT INTO story_studio_media (id, owner_id, studio_version, story_number, sha256, png_bytes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id, user.id(), studioVersion, storyNumber, sha256, png, java.sql.Timestamp.from(expiresAt));
        return response(new MediaRecord(id, storyNumber, studioVersion, sha256, expiresAt));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> list(AuthenticatedUser user, long studioVersion) {
        requireAdmin(user);
        if (studioVersion < 1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Studio version");
        List<MediaRecord> media = jdbc.query(
                "SELECT DISTINCT ON (story_number) id, story_number, studio_version, sha256, expires_at " +
                "FROM story_studio_media WHERE owner_id = ? AND studio_version = ? AND expires_at > CURRENT_TIMESTAMP " +
                "ORDER BY story_number, created_at DESC, id DESC",
                (rs, row) -> new MediaRecord(
                        rs.getObject("id", UUID.class), rs.getInt("story_number"),
                        rs.getLong("studio_version"), rs.getString("sha256"),
                        rs.getTimestamp("expires_at").toInstant()), user.id(), studioVersion);
        List<Map<String, Object>> result = new ArrayList<>();
        for (MediaRecord record : media) result.add(response(record));
        return Map.of("studioVersion", studioVersion, "media", result,
                "complete", media.size() == 3,
                "instructions", "Schedule one Instagram STORY with these 3 mediaUrl values in storyNumber order. No publication occurs during upload.");
    }

    @Transactional(readOnly = true)
    public PngAsset validatedDownload(UUID id, long expires, String signature) {
        long now = Instant.now().getEpochSecond();
        if (id == null || expires <= now || expires > now + RETENTION.toSeconds()
                || signature == null || signature.length() > 128) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Story image not available");
        }
        byte[] provided;
        try { provided = Base64.getUrlDecoder().decode(signature); }
        catch (IllegalArgumentException invalid) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Story image not available");
        }
        if (!MessageDigest.isEqual(sign(id, expires), provided)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Story image not available");
        }
        List<PngAsset> matches = jdbc.query(
                "SELECT png_bytes FROM story_studio_media WHERE id = ? AND expires_at > CURRENT_TIMESTAMP " +
                        "AND FLOOR(EXTRACT(EPOCH FROM expires_at)) = ?",
                (rs, row) -> new PngAsset(rs.getBytes("png_bytes")), id, expires);
        if (matches.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Story image expired");
        return matches.get(0);
    }

    private Map<String, Object> response(MediaRecord media) {
        long expires = media.expiresAt().getEpochSecond();
        String signature = Base64.getUrlEncoder().withoutPadding().encodeToString(sign(media.id(), expires));
        String url = publicBaseUrl + "/api/v1/public/stories/media/" + media.id() + "?expires=" + expires + "&sig=" + signature;
        return Map.of("assetId", media.id().toString(), "storyNumber", media.storyNumber(),
                "studioVersion", media.studioVersion(), "sha256", media.sha256(),
                "expiresAt", media.expiresAt().toString(), "mediaUrl", url);
    }

    private byte[] sign(UUID id, long expires) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal((id + "." + expires).getBytes(StandardCharsets.UTF_8));
        } catch (Exception impossible) {
            throw new IllegalStateException("Story media signing unavailable", impossible);
        }
    }

    static void validatePng(byte[] bytes) {
        if (bytes == null || bytes.length < 57 || bytes.length > MAX_PNG_BYTES
                || !Arrays.equals(Arrays.copyOfRange(bytes, 0, 8), PNG_HEADER)
                || ByteBuffer.wrap(bytes, 8, 4).getInt() != 13
                || bytes[12] != 'I' || bytes[13] != 'H' || bytes[14] != 'D' || bytes[15] != 'R'
                || ByteBuffer.wrap(bytes, 16, 4).getInt() != WIDTH
                || ByteBuffer.wrap(bytes, 20, 4).getInt() != HEIGHT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected PNG 1080 x 1920, up to 3 MB");
        }
        try {
            var image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null || image.getWidth() != WIDTH || image.getHeight() != HEIGHT) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Corrupt PNG or incorrect dimensions");
            }
        } catch (IOException | IllegalArgumentException invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid PNG image");
        }
    }
}
