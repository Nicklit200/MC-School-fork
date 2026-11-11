package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Owner-only collection of reusable, declarative worksheet templates.
 * No provider/API call, script execution, lesson assignment or automatic
 * publication occurs when editing or saving this project.
 */
@Service
public class WorkbookStudioProjectService {
    static final int MAX_PROJECT_CHARS = 1_200_000;
    static final int MAX_PROJECT_BYTES = 1_500_000;
    static final int MAX_LESSON_CHARS = 115_000;
    private static final String SCHEMA = "mindcrafti.workbook-studio/1";
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Environment environment;

    public WorkbookStudioProjectService(JdbcTemplate jdbc, ObjectMapper mapper, Environment environment) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.environment = environment;
    }

    public void requireOwner(AuthenticatedUser caller) {
        // Do not grant this capability to every ADMIN, and never use a
        // frontend-only flag to enforce this security boundary.
        String configured = environment.getProperty("ADMIN_EMAIL", "").trim();
        if (caller == null || caller.role() != Role.ADMIN || caller.id() == null
                || caller.email() == null || configured.isBlank()
                || !configured.equalsIgnoreCase(caller.email().trim())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Workbook Studio belongs to the school owner");
        }
    }

    record Stored(long revision, String json, Instant updatedAt) {}

    private Stored find(AuthenticatedUser caller) {
        requireOwner(caller);
        return jdbc.query(
                "SELECT revision, project_json, updated_at FROM workbook_studio_projects WHERE owner_id = ?",
                (rs, row) -> new Stored(rs.getLong("revision"), rs.getString("project_json"),
                        rs.getTimestamp("updated_at").toInstant()), caller.id())
                .stream().findFirst().orElse(null);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> get(AuthenticatedUser caller) {
        Stored stored = find(caller);
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("configured", stored != null);
        answer.put("version", stored == null ? 0L : stored.revision());
        answer.put("schema", SCHEMA);
        answer.put("projectJson", stored == null ? null : stored.json());
        answer.put("updatedAt", stored == null ? null : stored.updatedAt().toString());
        return answer;
    }

    public Map<String, Object> example(AuthenticatedUser caller) throws IOException {
        requireOwner(caller);
        try (var input = new ClassPathResource(
                "owner-workbook-generator/examples/clean-tasks-demo.json").getInputStream()) {
            return Map.of("lessonJson", new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    @Transactional
    public Map<String, Object> save(AuthenticatedUser caller, long expectedVersion, String projectJson) {
        requireOwner(caller);
        if (expectedVersion < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid version");
        validateProject(projectJson);
        int changed;
        if (expectedVersion == 0) {
            changed = jdbc.update(
                    "INSERT INTO workbook_studio_projects(owner_id, revision, project_json)"
                    + " VALUES (?, 1, ?) ON CONFLICT (owner_id) DO NOTHING",
                    caller.id(), projectJson);
        } else {
            changed = jdbc.update(
                    "UPDATE workbook_studio_projects SET revision = revision + 1,"
                    + " project_json = ?, updated_at = CURRENT_TIMESTAMP"
                    + " WHERE owner_id = ? AND revision = ?",
                    projectJson, caller.id(), expectedVersion);
        }
        if (changed != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Another saved version exists. Export your edits before reloading.");
        }
        return get(caller);
    }

    void validateProject(String json) {
        if (json == null || json.isBlank() || json.length() > MAX_PROJECT_CHARS
                || json.getBytes(StandardCharsets.UTF_8).length > MAX_PROJECT_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Project is empty or too large");
        }
        try {
            Object raw = mapper.readValue(json, Object.class);
            if (!(raw instanceof Map<?, ?> root) || !SCHEMA.equals(root.get("schema"))
                    || !(root.get("templates") instanceof List<?> templates)
                    || templates.isEmpty() || templates.size() > 12
                    || !(root.get("activeTemplateId") instanceof String selected)) {
                throw new IllegalArgumentException("Invalid project structure");
            }
            var ids = new HashSet<String>();
            for (Object rawTemplate : templates) {
                if (!(rawTemplate instanceof Map<?, ?> template)
                        || !(template.get("id") instanceof String id)
                        || !id.matches("[a-zA-Z0-9_-]{1,80}") || !ids.add(id)
                        || !(template.get("name") instanceof String name)
                        || name.isBlank() || name.length() > 80
                        || !(template.get("document") instanceof Map<?, ?> document)) {
                    throw new IllegalArgumentException("Invalid template");
                }
                String lessonJson = mapper.writeValueAsString(document);
                if (lessonJson.length() > MAX_LESSON_CHARS) {
                    throw new IllegalArgumentException("Template document is too large");
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> typed = (Map<String, Object>) document;
                OwnerWorkbookPdfRenderService.validateDocument(typed);
            }
            if (!ids.contains(selected)) throw new IllegalArgumentException("Selected template is missing");
        } catch (Exception invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Expected a valid workbook template collection with student pages and separate teacher solutions");
        }
    }
}
