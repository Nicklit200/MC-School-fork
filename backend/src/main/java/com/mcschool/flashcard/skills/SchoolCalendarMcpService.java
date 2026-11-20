package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** First-class MCP commands for the same school calendars visible inside /skills. */
@Service
public class SchoolCalendarMcpService {
    public static final Set<String> TOOL_NAMES =
            Set.of("list_school_calendars", "get_school_calendar", "upsert_school_calendar");

    private final SchoolCalendarService calendars;
    private final SkillBoardService boards;
    private final ObjectMapper mapper;

    public SchoolCalendarMcpService(SchoolCalendarService calendars, SkillBoardService boards, ObjectMapper mapper) {
        this.calendars = calendars;
        this.boards = boards;
        this.mapper = mapper;
    }

    private static Map<String, Object> definition(String name, String description,
            Map<String, ?> properties, List<String> required, boolean readOnly) {
        return Map.of("name", name, "description", description,
            "inputSchema", Map.of("type", "object", "properties", properties,
                "required", required, "additionalProperties", false),
            "annotations", Map.of("readOnlyHint", readOnly, "destructiveHint", false,
                "idempotentHint", true, "openWorldHint", false));
    }

    public static List<Map<String, Object>> definitions() {
        Map<String, Object> selectors = new LinkedHashMap<>();
        selectors.put("boardId", Map.of("type","string", "description",
            "Optional exact existing curriculum board ID, e.g. grade-6. Otherwise uses a board for grade."));
        selectors.put("grade", Map.of("type","integer", "minimum",1, "maximum",13,
            "description","Required grade unless boardId is specified; default is grade 6."));
        selectors.put("schoolType", Map.of("type","string",
            "description","Required exact school type, e.g. WIRTSCHAFTSSCHULE, REALSCHULE, GYMNASIUM."));
        selectors.put("profile", Map.of("type","string",
            "description","Optional track (Wirtschaftsschule defaults to vierstufig). Must match saved plan."));
        selectors.put("month", Map.of("type","integer","minimum",1,"maximum",12,
            "description","Optional calendar month, 1–12. Returns full schedule plus the month's topics."));
        var list = definition("list_school_calendars",
            "List the saved monthly school-curriculum calendars attached to Mindcrafti skills boards. "
            + "Returns school type, grade, profile and evidence status; an absent plan is NOT a prediction. "
            + "School timetable examples from other schools are labelled unconfirmed.",
            Map.of("grade", Map.of("type","integer","minimum",1,"maximum",13,
                "description","Optional grade filter")), List.of(), true);
        var get = definition("get_school_calendar",
            "Read editable month-by-month curriculum topics from the live /skills database for a type of school, "
            + "grade and track. Use when an educator asks what students may study in a given month, "
            + "or BEFORE generating homework. This is only a REFERENCE: never present an illustrative "
            + "Stoffverteilungsplan as the actual pupil's school pace or as a confirmed exam timetable. "
            + "Check actual school lessons, teacher notes and tests first.",
            selectors, List.of("schoolType"), true);
        var change = new LinkedHashMap<>(selectors);
        change.remove("month");
        change.put("expectedRevision", Map.of("type","integer","minimum",1,
            "description","Latest exact boardRevision from get_school_calendar. Conflicts reject without overwriting."));
        change.put("calendarJson",Map.of("type","string",
            "description","Complete calendar metadata JSON with version=1, schoolType, grade, profile, "
                + "status, sourceLabel, sourceUrl, officialSourceUrl, disclaimer and months[] containing "
                + "{month, weeks, note, topics:[{name,boardTopicId?}]}. Limit 4000 characters. "
                + "EXAMPLE_NOT_SCHOOL_CONFIRMED must be used unless the actual school confirms it."));
        var edit = definition("upsert_school_calendar",
            "ADMIN ONLY: create or replace the monthly curriculum REFERENCE for one school type/grade/track. "
            + "Does not alter student mastery, lessons, exams or unrelated curriculum cards. "
            + "Use only on explicit approval, after reading get_school_calendar fresh; requires "
            + "expectedRevision and complete calendarJson. Check the readback after saving.",
            change, List.of("schoolType","expectedRevision","calendarJson"), false);
        return List.of(list, get, edit);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static int grade(Map<String, Object> args, int fallback) {
        Object raw = args.get("grade");
        if (raw == null) return fallback;
        if (!(raw instanceof Number n) || n.doubleValue() != n.intValue() || n.intValue() < 1 || n.intValue() > 13)
            throw bad("grade must be an integer between 1 and 13");
        return n.intValue();
    }

    private String boardId(Map<String, Object> args) {
        Object selected = args.get("boardId");
        if (selected != null) {
            if (!(selected instanceof String id) || id.isBlank()) throw bad("Invalid boardId");
            return id;
        }
        int grade = grade(args, 6);
        return boards.list().stream().filter(b -> b.grade() == grade)
            .map(SkillBoardService.BoardSummary::id).findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                "No curriculum board for grade " + grade));
    }

    private static String required(Map<String, Object> args, String key) {
        if (!(args.get(key) instanceof String text) || text.isBlank()) throw bad("Missing " + key);
        return text;
    }

    private static void keys(Map<String, Object> args, Set<String> allowed) {
        for (String key : args.keySet()) if (!allowed.contains(key)) throw bad("Unsupported field: " + key);
    }

    private static void reader(User caller) {
        if (caller == null || caller.getId() == null || caller.isArchived()
            || (caller.getRole() != Role.ADMIN && caller.getRole() != Role.TEACHER))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                "Only active Mindcrafti OAuth teachers and admins can access school calendars");
    }

    private Map<String, Object> list(Map<String, Object> args) {
        int filter = grade(args, 0);
        List<Map<String, Object>> entries = new ArrayList<>();
        for (var summary : boards.list()) {
            if (filter != 0 && summary.grade() != filter) continue;
            var board = boards.get(summary.id());
            for (var node : board.data().nodes()) {
                if (!SchoolCalendarService.isCalendarNode(node) || node.archived()) continue;
                try {
                    @SuppressWarnings("unchecked") Map<String, Object> data =
                        mapper.readValue(node.description(), Map.class);
                    Map<String, Object> one = new LinkedHashMap<>();
                    one.put("boardId", board.id());
                    one.put("boardRevision", board.revision());
                    one.put("grade", summary.grade());
                    one.put("schoolType", data.get("schoolType"));
                    one.put("profile", data.get("profile"));
                    one.put("status", data.get("status"));
                    one.put("sourceLabel", data.getOrDefault("sourceLabel", ""));
                    entries.add(one);
                } catch (RuntimeException invalid) {
                    // A malformed metadata note must not suppress other, valid calendars.
                }
            }
        }
        return Map.of("calendars", entries, "source", "mindcrafti_database",
            "pagePath", "/skills");
    }

    public Map<String, Object> call(String name, Map<String, Object> args, User caller) {
        try {
            if (!TOOL_NAMES.contains(name)) throw bad("Unknown school calendar tool");
            reader(caller);
            if ("list_school_calendars".equals(name)) {
                keys(args, Set.of("grade"));
                return result(list(args), false);
            }
            if ("get_school_calendar".equals(name)) {
                keys(args, Set.of("boardId","grade","schoolType","profile","month"));
                Object rawMonth = args.get("month");
                Integer month = null;
                if (rawMonth != null) {
                    if (!(rawMonth instanceof Number n) || n.doubleValue() != n.intValue()
                        || n.intValue() < 1 || n.intValue() > 12) throw bad("Invalid month");
                    month = n.intValue();
                }
                return result(calendars.get(boardId(args), required(args,"schoolType"),
                    (String)args.get("profile"), month), false);
            }
            keys(args, Set.of("boardId","grade","schoolType","profile","expectedRevision","calendarJson"));
            if (caller.getRole() != Role.ADMIN)
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only administrators may edit school calendars");
            if (!(args.get("expectedRevision") instanceof Number n) || n.doubleValue() != n.longValue())
                throw bad("Invalid expectedRevision");
            return result(calendars.put(boardId(args), required(args,"schoolType"),
                (String)args.get("profile"), n.longValue(), required(args,"calendarJson"),
                caller.getId()), false);
        } catch (ResponseStatusException ex) {
            int status = ex.getStatusCode().value();
            String code = status == 409 ? "REVISION_CONFLICT" : status == 403 ? "FORBIDDEN"
                : status == 404 ? "NOT_FOUND" : "INVALID_SCHOOL_CALENDAR";
            return result(Map.of("saved",false,"errorCode",code,
                "message",ex.getReason() == null ? code : ex.getReason()), true);
        } catch (IllegalArgumentException | ClassCastException ex) {
            return result(Map.of("saved",false,"errorCode","INVALID_SCHOOL_CALENDAR",
                "message",ex.getMessage() == null ? "Invalid request" : ex.getMessage()), true);
        }
    }

    private Map<String, Object> result(Map<String, Object> data, boolean isError) {
        return Map.of("content", List.of(Map.of("type","text","text",mapper.writeValueAsString(data))),
            "structuredContent",data,"isError",isError);
    }
}
