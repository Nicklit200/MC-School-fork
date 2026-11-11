package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * A safe, data-only interface for global generator tuning.
 *
 * Never accepts executable JavaScript, CSS, shell commands or raw templates.
 * A saved draft does not change school lessons until it is tested and activated.
 */
@Service
public class WorkbookGeneratorLayoutService {
    private static final Logger LOG = LoggerFactory.getLogger(WorkbookGeneratorLayoutService.class);
    public static final String SCHEMA = "mindcrafti.generator-layout/1";
    public static final String DEFAULT_JSON = "{\"schema\":\"mindcrafti.generator-layout/1\","
            + "\"graphHeightMm\":68,\"graphWidthPercent\":100,\"graphPlotScalePercent\":100,"
            + "\"graphAlignment\":\"center\",\"blockGapMm\":3.6,"
            + "\"answerSpacePercent\":100,\"taskTitleFontPx\":14}";
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final WorkbookStudioProjectService owner;

    public WorkbookGeneratorLayoutService(JdbcTemplate jdbc, ObjectMapper mapper,
                                          WorkbookStudioProjectService owner) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.owner = owner;
    }

    private record Stored(long draftRevision, long activeRevision, long testedRevision,
                          String draft, String active, String previous, String updatedAt) {}

    private Stored row() {
        return jdbc.query("""
                 SELECT draft_revision, active_revision, tested_revision,
                        draft_json, active_json, previous_active_json,
                        updated_at
                 FROM workbook_generator_layout_profiles WHERE id = 1
                 """, (rs, index) -> new Stored(
                rs.getLong("draft_revision"), rs.getLong("active_revision"),
                rs.getLong("tested_revision"), rs.getString("draft_json"),
                rs.getString("active_json"), rs.getString("previous_active_json"),
                rs.getTimestamp("updated_at").toInstant().toString()))
                .stream().findFirst().orElseThrow(() ->
                        new IllegalStateException("Workbook layout profile migration V106 is missing"));
    }

    /** Reads active style for every normal workbook render; current lessons are unchanged. */
    @Transactional(readOnly = true)
    public String activeJson() {
        return row().active();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> get(AuthenticatedUser caller) {
        owner.requireOwner(caller);
        Stored current = row();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("draftRevision", current.draftRevision());
        result.put("activeRevision", current.activeRevision());
        result.put("testedRevision", current.testedRevision());
        result.put("draftJson", current.draft());
        result.put("activeJson", current.active());
        result.put("canActivate", current.testedRevision() == current.draftRevision()
                && !current.draft().equals(current.active()));
        result.put("canRollback", current.previous() != null);
        result.put("updatedAt", current.updatedAt());
        return result;
    }

    @Transactional
    public Map<String, Object> saveDraft(AuthenticatedUser caller, long expectedRevision, String json) {
        owner.requireOwner(caller);
        String canonical = validate(json);
        if (expectedRevision < 0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid draft revision");
        int changed = jdbc.update("""
                UPDATE workbook_generator_layout_profiles
                SET draft_revision = draft_revision + 1, draft_json = ?,
                    tested_revision = -1, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1 AND draft_revision = ?
                """, canonical, expectedRevision);
        if (changed != 1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The generator draft changed. Reload before saving.");
        return get(caller);
    }

    @Transactional(readOnly = true)
    public String requireDraftForTest(AuthenticatedUser caller, long expectedRevision) {
        owner.requireOwner(caller);
        Stored current = row();
        if (current.draftRevision() != expectedRevision)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Generator draft changed. Reload before testing.");
        return current.draft();
    }

    /** Called only after both real PDFs pass the existing mathematics and A4 layout QA. */
    @Transactional
    public Map<String, Object> markTested(AuthenticatedUser caller, long revision, String testedJson) {
        owner.requireOwner(caller);
        int changed = jdbc.update("""
                UPDATE workbook_generator_layout_profiles
                SET tested_revision = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1 AND draft_revision = ? AND draft_json = ?
                """, revision, revision, testedJson);
        if (changed != 1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The generator draft changed during PDF test. Test the new revision.");
        return get(caller);
    }

    @Transactional
    public Map<String, Object> activate(AuthenticatedUser caller, long expectedDraftRevision,
                                         long expectedActiveRevision) {
        owner.requireOwner(caller);
        int changed = jdbc.update("""
                UPDATE workbook_generator_layout_profiles
                SET previous_active_json = active_json, active_json = draft_json,
                    active_revision = active_revision + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1 AND draft_revision = ? AND active_revision = ?
                  AND tested_revision = draft_revision AND active_json <> draft_json
                """, expectedDraftRevision, expectedActiveRevision);
        if (changed != 1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Test and review the current draft before approving it, then reload.");
        LOG.info("Workbook generator layout approved: draftRevision={} priorActiveRevision={}",
                expectedDraftRevision, expectedActiveRevision);
        return get(caller);
    }

    @Transactional
    public Map<String, Object> rollback(AuthenticatedUser caller, long expectedActiveRevision) {
        owner.requireOwner(caller);
        int changed = jdbc.update("""
                UPDATE workbook_generator_layout_profiles
                SET active_json = previous_active_json,
                    previous_active_json = active_json,
                    active_revision = active_revision + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1 AND active_revision = ? AND previous_active_json IS NOT NULL
                """, expectedActiveRevision);
        if (changed != 1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "No earlier approved settings available, or another revision has been activated.");
        LOG.info("Workbook generator layout restored to previous approved profile");
        return get(caller);
    }

    /** Strongly typed numeric limits; rejects extra keys, code, URLs, CSS and HTML. */
    static String validate(String json) {
        if (json == null || json.isBlank() || json.length() > 1800)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Generator settings are too large");
        Map<?, ?> map;
        try {
            map = new ObjectMapper().readValue(json, Map.class);
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Generator settings must be JSON");
        }
        if (map == null || map.size() != 8 || !SCHEMA.equals(map.get("schema"))
                || !List.of("center", "left").contains(map.get("graphAlignment"))
                || !intBetween(map.get("graphHeightMm"), 60, 85)
                || !intBetween(map.get("graphWidthPercent"), 75, 100)
                || !intBetween(map.get("graphPlotScalePercent"), 90, 110)
                || !numberBetween(map.get("blockGapMm"), 2, 8)
                || !intBetween(map.get("answerSpacePercent"), 60, 120)
                || !intBetween(map.get("taskTitleFontPx"), 12, 18)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Invalid or unsupported generator layout settings");
        }
        // Preserve exactly validated fields, never arbitrary code supplied by a model.
        return new ObjectMapper().writeValueAsString(Map.of(
                "schema", SCHEMA,
                "graphHeightMm", map.get("graphHeightMm"),
                "graphWidthPercent", map.get("graphWidthPercent"),
                "graphPlotScalePercent", map.get("graphPlotScalePercent"),
                "graphAlignment", map.get("graphAlignment"),
                "blockGapMm", map.get("blockGapMm"),
                "answerSpacePercent", map.get("answerSpacePercent"),
                "taskTitleFontPx", map.get("taskTitleFontPx")));
    }

    private static boolean intBetween(Object value, int min, int max) {
        return value instanceof Number n && n.doubleValue() == n.intValue()
                && n.intValue() >= min && n.intValue() <= max;
    }
    private static boolean numberBetween(Object value, double min, double max) {
        return value instanceof Number n && Double.isFinite(n.doubleValue())
                && n.doubleValue() >= min && n.doubleValue() <= max;
    }
}
