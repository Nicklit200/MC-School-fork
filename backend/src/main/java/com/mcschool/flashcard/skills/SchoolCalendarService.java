package com.mcschool.flashcard.skills;

import java.util.*;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import static com.mcschool.flashcard.skills.SkillBoardService.*;

/**
 * Teacher-readable, administrator-editable month-by-month curriculum references.
 *
 * A calendar is a metadata NOTE in the existing revisioned curriculum board, not a
 * pupil skill and not evidence of a pupil's progress. This preserves all existing
 * board IDs, mastery, revisions, permissions and history without a new database.
 */
@Service
public class SchoolCalendarService {
    private static final String PREFIX = "school_calendar_";
    private static final Set<String> SCHOOL_TYPES = Set.of(
        "GYMNASIUM", "REALSCHULE", "MITTELSCHULE", "WIRTSCHAFTSSCHULE",
        "FACHOBERSCHULE", "GESAMTSCHULE", "WERKREALSCHULE", "OTHER");
    private static final Set<String> STATUSES =
        Set.of("DRAFT", "EXAMPLE_NOT_SCHOOL_CONFIRMED", "SCHOOL_CONFIRMED");
    private static final Pattern PROFILE = Pattern.compile("[a-z0-9-]{2,24}");

    private final SkillBoardService boards;
    private final ObjectMapper mapper;

    public SchoolCalendarService(SkillBoardService boards, ObjectMapper mapper) {
        this.boards = boards;
        this.mapper = mapper;
    }

    public static String defaultProfile(String schoolType) {
        return "WIRTSCHAFTSSCHULE".equals(schoolType) ? "vierstufig" : "allgemein";
    }

    public static boolean isCalendarNode(Node node) {
        return node != null && node.kind().equals("note") && node.id().startsWith(PREFIX);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static String normalizeSchool(String schoolType) {
        if (schoolType == null || !SCHOOL_TYPES.contains(schoolType))
            throw bad("Unknown schoolType. Use the exact school type from the student profile.");
        return schoolType;
    }

    private static String normalizeProfile(String profile, String schoolType) {
        String value = profile == null || profile.isBlank() ? defaultProfile(schoolType) : profile;
        if (!PROFILE.matcher(value).matches()) throw bad("Invalid profile");
        return value;
    }

    public static String noteId(String schoolType, int grade, String profile) {
        if (grade < 1 || grade > 13) throw bad("Invalid grade");
        return PREFIX + normalizeSchool(schoolType).toLowerCase(Locale.ROOT)
            + "_" + grade + "_" + normalizeProfile(profile, schoolType).replace('-', '_');
    }

    private static String limited(Object value, int max, String key, boolean required) {
        if (!(value instanceof String s)) {
            if (!required && value == null) return "";
            throw bad(key + " must be text");
        }
        if (s.length() > max || (required && s.isBlank())) throw bad("Invalid " + key);
        return s;
    }

    private static int integer(Object value, String key) {
        if (!(value instanceof Number n) || n.doubleValue() != n.intValue())
            throw bad(key + " must be an integer");
        return n.intValue();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(String json) {
        try {
            Object parsed = mapper.readValue(json, Map.class);
            if (!(parsed instanceof Map<?,?> input)) throw bad("Calendar must be a JSON object");
            Map<String, Object> result = new LinkedHashMap<>();
            for (var entry : input.entrySet()) {
                if (!(entry.getKey() instanceof String k)) throw bad("Invalid calendar field");
                result.put(k, entry.getValue());
            }
            return result;
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            throw bad("Calendar JSON is invalid");
        }
    }

    private static void checkUrl(Object value, String key) {
        String url = limited(value, 500, key, false);
        if (!url.isBlank() && !url.startsWith("https://"))
            throw bad(key + " must be an HTTPS URL");
    }

    private void validate(Map<String, Object> calendar, Snapshot snapshot,
                          String schoolType, String profile) {
        if (integer(calendar.get("version"), "version") != 1) throw bad("Unsupported calendar version");
        if (!schoolType.equals(calendar.get("schoolType")) ||
            snapshot.data().grade() != integer(calendar.get("grade"), "grade") ||
            !profile.equals(calendar.get("profile")))
            throw bad("School type, grade and profile must match the target board");
        String status = limited(calendar.get("status"), 50, "status", true);
        if (!STATUSES.contains(status)) throw bad("Unsupported calendar status");
        limited(calendar.get("sourceLabel"), 500, "sourceLabel", false);
        limited(calendar.get("disclaimer"), 1000, "disclaimer", true);
        checkUrl(calendar.get("sourceUrl"), "sourceUrl");
        checkUrl(calendar.get("officialSourceUrl"), "officialSourceUrl");
        if ("SCHOOL_CONFIRMED".equals(status) &&
            limited(calendar.get("sourceLabel"), 500, "sourceLabel", true).isBlank())
            throw bad("A school-confirmed plan must identify its source");
        if (!(calendar.get("months") instanceof List<?> months) || months.size() > 12)
            throw bad("Provide an array of up to twelve months");
        Set<Integer> found = new HashSet<>();
        for (Object rawMonth : months) {
            if (!(rawMonth instanceof Map<?,?> month)) throw bad("Invalid month");
            int number = integer(month.get("month"), "month");
            if (number < 1 || number > 12 || !found.add(number)) throw bad("Duplicate or invalid month");
            limited(month.get("weeks"), 100, "weeks", false);
            limited(month.get("note"), 900, "note", false);
            if (!(month.get("topics") instanceof List<?> topics) || topics.size() > 12)
                throw bad("Each month requires up to twelve topics");
            for (Object rawTopic : topics) {
                if (!(rawTopic instanceof Map<?,?> topic)) throw bad("Invalid topic");
                limited(topic.get("name"), 160, "topic.name", true);
                Object ref = topic.get("boardTopicId");
                if (ref != null) {
                    if (!(ref instanceof String id) || snapshot.data().nodes().stream()
                        .noneMatch(n -> n.id().equals(id) && n.kind().equals("topic")))
                        throw bad("boardTopicId must refer to an existing topic in this board");
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> get(String boardId, String schoolType,
                                   String profile, Integer month) {
        schoolType = normalizeSchool(schoolType);
        profile = normalizeProfile(profile, schoolType);
        if (month != null && (month < 1 || month > 12)) throw bad("Invalid month");
        Snapshot snapshot = boards.get(boardId);
        String id = noteId(schoolType, snapshot.data().grade(), profile);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", "mindcrafti_database");
        response.put("pagePath", "/skills");
        response.put("boardId", snapshot.id());
        response.put("boardRevision", snapshot.revision());
        response.put("schoolType", schoolType);
        response.put("profile", profile);
        response.put("grade", snapshot.data().grade());
        response.put("calendarNodeId", id);
        Node match = snapshot.data().nodes().stream().filter(n -> n.id().equals(id)).findFirst().orElse(null);
        if (match == null || match.archived()) {
            response.put("available", false);
            response.put("status", "NOT_CONFIGURED");
            response.put("note", "No calendar for this school type and grade. Do not infer months or tests.");
            return response;
        }
        Map<String, Object> calendar = parse(match.description());
        validate(calendar, snapshot, schoolType, profile);
        response.put("available", true);
        response.put("calendar", calendar);
        response.put("status", calendar.get("status"));
        response.put("calendarIsIllustrative", !"SCHOOL_CONFIRMED".equals(calendar.get("status")));
        response.put("lessonPlanningNote",
            "This is a calendar REFERENCE, not evidence that this class taught the topic or an exam is scheduled. " +
            "Prioritize the pupil's actual school work, teacher announcements and last lesson evidence.");
        if (month != null) {
            Map<String, Object> selectedMonth = ((List<Map<String, Object>>)calendar.get("months"))
                .stream().filter(m -> month.equals(m.get("month"))).findFirst().orElse(null);
            response.put("requestedMonth", month);
            response.put("monthPlan", selectedMonth == null ? Map.of() : selectedMonth);
        }
        return response;
    }

    public Map<String, Object> put(String boardId, String schoolType, String profile,
                                   long expectedRevision, String calendarJson, UUID callerId) {
        schoolType = normalizeSchool(schoolType);
        profile = normalizeProfile(profile, schoolType);
        if (expectedRevision < 1) throw bad("expectedRevision must be positive");
        if (calendarJson == null || calendarJson.length() > 4000)
            throw bad("Calendar must fit the 4000-character metadata limit");
        Snapshot before = boards.get(boardId);
        if (before.revision() != expectedRevision)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Calendar changed since last read");
        Map<String, Object> calendar = parse(calendarJson);
        validate(calendar, before, schoolType, profile);
        String serialized = mapper.writeValueAsString(calendar);
        if (serialized.length() > 4000) throw bad("Calendar is too long");
        String id = noteId(schoolType, before.data().grade(), profile);
        List<Node> nodes = new ArrayList<>(before.data().nodes());
        Node previous = nodes.stream().filter(n -> n.id().equals(id)).findFirst().orElse(null);
        Node updated = new Node(id, "note",
            previous != null ? previous.title() : "Календарь тем · " + schoolType + " · " + before.data().grade(),
            previous != null ? previous.de() : "Примерный план, не расписание контрольных",
            serialized, "", limited(calendar.get("sourceLabel"), 500, "sourceLabel", false),
            "blue", previous == null ? 3600 : previous.x(),
            previous == null ? 2200 : previous.y(),
            false, false, List.of(schoolType));
        if (previous != null) {
            nodes.set(nodes.indexOf(previous), updated);
        } else {
            nodes.add(updated);
        }
        Board current = before.data();
        Board next = new Board(current.schemaVersion(), current.title(), current.grade(),
            current.source(), nodes, current.edges());
        Snapshot saved = boards.save(boardId, new SaveRequest(expectedRevision, next), callerId);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("saved", true);
        response.put("boardId", saved.id());
        response.put("boardRevision", saved.revision());
        response.put("calendarNodeId", id);
        response.put("calendar", calendar);
        response.put("pagePath", "/skills");
        return response;
    }

    /** Optional planning hint for the already authorized pupil context, not a claim of school progress. */
    public Map<String, Object> referenceForStudent(int grade, String schoolType, int month) {
        if (grade < 1 || grade > 13 || schoolType == null || !SCHOOL_TYPES.contains(schoolType))
            return Map.of("available", false, "reason", "UNSUPPORTED_STUDENT_PROFILE");
        for (BoardSummary board : boards.list()) {
            if (board.grade() != grade) continue;
            Map<String, Object> found = get(board.id(), schoolType, defaultProfile(schoolType), month);
            if (Boolean.TRUE.equals(found.get("available"))) return found;
        }
        return Map.of("available", false, "reason", "NO_CALENDAR_FOR_THIS_GRADE_AND_SCHOOL",
            "schoolType", schoolType, "grade", grade);
    }
}
