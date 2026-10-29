package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** The browser editor's project, intentionally separate from the three-slide PPTX store. */
@Service
public class StoryStudioProjectService {
    static final int MAX_CHARS = 1_900_000;
    static final int MAX_BYTES = 4 * 1024 * 1024;
    static final int CHUNK_BYTES = 64 * 1024;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public StoryStudioProjectService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    record Stored(long version, String json, String sha256, Instant updatedAt) {}

    private void requireAdmin(AuthenticatedUser user) {
        if (user == null || user.id() == null || user.role() != Role.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Administrator access required");
        }
    }

    private Stored find(AuthenticatedUser user) {
        requireAdmin(user);
        return jdbc.query("SELECT revision, project_json, sha256, updated_at FROM story_studio_projects WHERE owner_id = ?",
                (rs, row) -> new Stored(rs.getLong("revision"), rs.getString("project_json"),
                        rs.getString("sha256"), rs.getTimestamp("updated_at").toInstant()), user.id())
                .stream().findFirst().orElse(null);
    }

    private Map<String, Object> metadata(Stored stored) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("configured", stored != null);
        result.put("version", stored == null ? 0L : stored.version());
        result.put("format", "MINDCRAFTI_STUDIO_PROJECT_JSON");
        result.put("source", "AdminMindcraftiStudioPage");
        result.put("filename", "Mindcrafti_Stories_Studio.json");
        result.put("sha256", stored == null ? null : stored.sha256());
        result.put("updatedAt", stored == null ? null : stored.updatedAt().toString());
        int size = stored == null ? 0 : stored.json().getBytes(StandardCharsets.UTF_8).length;
        result.put("sizeBytes", size);
        result.put("chunkCount", (size + CHUNK_BYTES - 1) / CHUNK_BYTES);
        result.put("instructions", stored == null
                ? "Open Stories Studio once in the original admin browser to sync its existing local project. Do not request a PPTX or substitute a Library template."
                : "This is the exact admin editor project: story, css, html and assets.logoSrc. Download all chunks with this version and verify SHA-256. Preserve the design and logo. No publication has been scheduled by reading or saving this project.");
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> info(AuthenticatedUser user) { return metadata(find(user)); }

    @Transactional(readOnly = true)
    public Map<String, Object> get(AuthenticatedUser user) {
        Stored stored = find(user);
        Map<String, Object> result = metadata(stored);
        result.put("projectJson", stored == null ? null : stored.json());
        return result;
    }

    @Transactional
    public Map<String, Object> save(AuthenticatedUser user, long expectedVersion, String projectJson) {
        requireAdmin(user);
        if (expectedVersion < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid expectedVersion");
        validateProject(projectJson);
        String digest = sha256(projectJson.getBytes(StandardCharsets.UTF_8));
        int changed;
        if (expectedVersion == 0) {
            changed = jdbc.update("INSERT INTO story_studio_projects(owner_id, revision, project_json, sha256) VALUES (?, 1, ?, ?) ON CONFLICT (owner_id) DO NOTHING",
                    user.id(), projectJson, digest);
        } else {
            changed = jdbc.update("UPDATE story_studio_projects SET revision = revision + 1, project_json = ?, sha256 = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND revision = ?",
                    projectJson, digest, user.id(), expectedVersion);
        }
        if (changed != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The cloud project changed. Keep your local draft and reload before saving; do not overwrite another version.");
        }
        return metadata(find(user));
    }

    void validateProject(String json) {
        if (json == null || json.length() > MAX_CHARS || json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Studio project is too large");
        }
        try {
            Object parsed = mapper.readValue(json, Object.class);
            if (!(parsed instanceof Map<?, ?> p)
                    || !(p.get("story") instanceof Map<?, ?>)
                    || !(p.get("css") instanceof String css) || css.isBlank()
                    || !(p.get("html") instanceof String html) || html.isBlank()
                    || !(p.get("assets") instanceof Map<?, ?> assets)
                    || !(assets.get("logoSrc") instanceof String logo)
                    || !logo.matches("data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/=\\r\\n]+")) {
                throw new IllegalArgumentException("Invalid project");
            }
        } catch (Exception invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected Studio story, css, html and embedded original assets.logoSrc");
        }
    }

    @Transactional(readOnly = true)
    public byte[] download(AuthenticatedUser user, long version) {
        Stored stored = requireVersion(user, version);
        return stored.json().getBytes(StandardCharsets.UTF_8);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> chunk(AuthenticatedUser user, long version, int chunkIndex) {
        Stored stored = requireVersion(user, version);
        byte[] bytes = stored.json().getBytes(StandardCharsets.UTF_8);
        int count = (bytes.length + CHUNK_BYTES - 1) / CHUNK_BYTES;
        if (chunkIndex < 0 || chunkIndex >= count) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid chunkIndex");
        }
        int start = chunkIndex * CHUNK_BYTES;
        return Map.of("version", stored.version(), "sha256", stored.sha256(), "chunkIndex", chunkIndex,
                "chunkCount", count, "base64", Base64.getEncoder().encodeToString(
                        Arrays.copyOfRange(bytes, start, Math.min(start + CHUNK_BYTES, bytes.length))));
    }

    private Stored requireVersion(AuthenticatedUser user, long version) {
        Stored stored = find(user);
        if (stored == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Open the admin Stories Studio once to sync the project");
        if (version != stored.version()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Studio version changed; read info and restart download");
        return stored;
    }

    static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
