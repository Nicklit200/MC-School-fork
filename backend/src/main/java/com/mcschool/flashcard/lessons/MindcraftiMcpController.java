package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Remote MCP server for the Mindcrafti ChatGPT app. */
@RestController
@RequestMapping("/api/v1/mcp")
public class MindcraftiMcpController {

    private static final String API_KEY_HEADER = "X-Mindcrafti-Api-Key";
    private static final String SERVER_NAME = "mindcrafti-lessons";
    private static final String SERVER_VERSION = "1.4.0";

    private final String apiKey;
    private final ObjectMapper objectMapper;
    private final UserRepository userRepository;
    private final McpOAuthService oauthService;
    private final GoogleCalendarLessonService calendarLessonService;
    private final LessonPreparationService preparationService;
    private final GoogleDriveService googleDriveService;

    public MindcraftiMcpController(
            @Value("${MINDCRAFTI_LESSON_IMPORT_API_KEY:}") String apiKey,
            ObjectMapper objectMapper,
            UserRepository userRepository,
            McpOAuthService oauthService,
            GoogleCalendarLessonService calendarLessonService,
            LessonPreparationService preparationService,
            GoogleDriveService googleDriveService) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
        this.oauthService = oauthService;
        this.calendarLessonService = calendarLessonService;
        this.preparationService = preparationService;
        this.googleDriveService = googleDriveService;
    }

    /** Streamable HTTP clients may probe GET for SSE. We do not need server-initiated messages. */
    @GetMapping
    public ResponseEntity<Void> get() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .header(HttpHeaders.ALLOW, "POST")
                .build();
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> post(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestHeader(value = API_KEY_HEADER, required = false) String suppliedApiKey,
            @RequestBody Map<String, Object> body) {
        AuthContext auth = authenticationContext(authorization, suppliedApiKey);

        String method = string(body.get("method"));
        Object id = body.get("id");
        boolean notification = id == null;

        if (notification) {
            return ResponseEntity.accepted().build();
        }

        try {
            Object result = switch (method) {
                case "initialize" -> initialize(body, auth.authenticated());
                case "server/discover" -> discover(auth.authenticated());
                case "ping" -> Map.of();
                case "tools/list" -> Map.of("tools", tools(auth.authenticated()));
                case "tools/call" -> callTool(body, auth);
                default -> null;
            };
            if (result == null) {
                return ResponseEntity.status(HttpStatus.OK).body(error(id, -32601, "Method not found: " + method));
            }
            return ResponseEntity.ok(success(id, result));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.ok(error(id, -32602, ex.getMessage()));
        } catch (Exception ex) {
            return ResponseEntity.ok(error(id, -32603, ex.getMessage() == null ? "Internal error" : ex.getMessage()));
        }
    }

    private Map<String, Object> initialize(Map<String, Object> request, boolean authenticated) {
        Map<String, Object> params = map(request.get("params"));
        String requested = string(params.get("protocolVersion"));
        String protocolVersion = requested.isBlank() ? "2025-11-25" : requested;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("protocolVersion", protocolVersion);
        result.put("capabilities", Map.of("tools", Map.of("listChanged", true)));
        result.put("serverInfo", Map.of("name", SERVER_NAME, "version", SERVER_VERSION));
        result.put("instructions", authenticated
                ? "Use find_lessons to resolve the exact calendar event before reading or writing lesson preparation data. Use attach_lesson_answers when a teacher-answer PDF must be copied from Google Drive into a lesson."
                : "The connector is in diagnostic mode. Sign in with Mindcrafti OAuth to access school data tools.");
        return result;
    }

    private Map<String, Object> discover(boolean authenticated) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("resultType", "complete");
        result.put("supportedVersions", List.of("2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"));
        result.put("capabilities", Map.of("tools", Map.of()));
        result.put("serverInfo", Map.of("name", SERVER_NAME, "version", SERVER_VERSION));
        result.put("instructions", authenticated
                ? "Mindcrafti lesson preparation tools. Resolve a lesson first, then update only the intended calendar event."
                : "Mindcrafti diagnostic MCP connection. No school data is exposed without authentication.");
        return result;
    }

    private List<Map<String, Object>> tools(boolean authenticated) {
        List<Map<String, Object>> tools = new ArrayList<>();

        tools.add(tool(
                "mindcrafti_status",
                "Check that the Mindcrafti MCP server is reachable. This diagnostic tool does not expose student, teacher, lesson, calendar, or Google Drive data.",
                schema(Map.of(), List.of()),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        if (!authenticated) return tools;

        tools.add(tool(
                "find_lessons",
                "Find upcoming Mindcrafti lessons. Admins can search all connected teacher calendars; teachers can search only their own calendar.",
                schema(
                        Map.of("query", property("string", "Optional student, group, or event title filter. Leave blank to list all upcoming lessons you can access.")),
                        List.of()),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        tools.add(tool(
                "get_lesson_preparation",
                "Read the workbook and teacher-answer status plus preparation notes currently stored for one concrete lesson.",
                schema(
                        Map.of(
                                "teacherId", property("string", "Teacher UUID returned by find_lessons."),
                                "eventId", property("string", "Google Calendar event ID returned by find_lessons.")),
                        List.of("teacherId", "eventId")),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        Map<String, Object> prepareProperties = new LinkedHashMap<>();
        prepareProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        prepareProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        prepareProperties.put("homeworkNotes", property("string", "Homework completion/status and relevant notes for the teacher."));
        prepareProperties.put("difficulties", property("string", "Observed gaps, recurring errors, or difficulties to address."));
        prepareProperties.put("lessonPlan", property("string", "Concise plan for the lesson."));
        prepareProperties.put("driveWorkbookFileId", property("string", "Optional Google Drive PDF file ID. If supplied, Mindcrafti copies that PDF into this lesson as its workbook."));
        prepareProperties.put("workbookFilename", property("string", "Optional workbook PDF filename shown on the lesson page, for example Christian_2026-09-07.pdf."));
        prepareProperties.put("driveAnswersFileId", property("string", "Optional Google Drive PDF file ID containing teacher answers/solutions. If supplied, Mindcrafti copies that PDF into this lesson as teacher answers."));
        prepareProperties.put("answersFilename", property("string", "Optional teacher-answer PDF filename shown on the lesson page, for example Christian_2026-09-07_answers.pdf."));

        tools.add(tool(
                "prepare_lesson",
                "Create or update a concrete lesson preparation. Only supplied text fields change; omitted text fields are preserved. Optionally copy workbook and teacher-answer PDFs from Google Drive into the lesson.",
                schema(prepareProperties, List.of("teacherId", "eventId")),
                Map.of("readOnlyHint", false, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        Map<String, Object> answerProperties = new LinkedHashMap<>();
        answerProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        answerProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        answerProperties.put("driveFileId", property("string", "Google Drive PDF file ID containing the teacher answers or solutions."));
        answerProperties.put("filename", property("string", "Optional PDF filename shown in the lesson's teacher-answer section."));

        tools.add(tool(
                "attach_lesson_answers",
                "Copy a teacher-answer or solution PDF from Google Drive into one concrete Mindcrafti lesson. Use this when the workbook is already attached and only the answers need to be added or replaced.",
                schema(answerProperties, List.of("teacherId", "eventId", "driveFileId")),
                Map.of("readOnlyHint", false, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        return tools;
    }

    private Map<String, Object> callTool(Map<String, Object> request, AuthContext auth) throws Exception {
        Map<String, Object> params = map(request.get("params"));
        String name = string(params.get("name"));
        Map<String, Object> arguments = map(params.get("arguments"));

        if ("mindcrafti_status".equals(name)) {
            Map<String, Object> status = new LinkedHashMap<>();
            status.put("status", "ok");
            status.put("service", SERVER_NAME);
            status.put("version", SERVER_VERSION);
            status.put("authenticated", auth.authenticated());
            status.put("mode", auth.authenticated() ? "full" : "diagnostic");
            status.put("authentication", auth.apiKey() ? "api_key" : auth.user() != null ? "oauth" : "none");
            if (auth.user() != null) status.put("role", auth.user().getRole().name());
            return toolResult(status);
        }

        if (!auth.authenticated()) {
            throw new IllegalArgumentException("This Mindcrafti tool requires authentication");
        }

        return switch (name) {
            case "find_lessons" -> toolResult(findLessons(string(arguments.get("query")), auth));
            case "get_lesson_preparation" -> toolResult(getPreparation(arguments, auth));
            case "prepare_lesson" -> toolResult(prepareLesson(arguments, auth));
            case "attach_lesson_answers" -> toolResult(attachLessonAnswers(arguments, auth));
            default -> throw new IllegalArgumentException("Unknown tool: " + name);
        };
    }

    private List<Map<String, Object>> findLessons(String query, AuthContext auth) {
        String normalizedQuery = normalize(query);
        List<Map<String, Object>> result = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived() || teacher.getGoogleCalendarRefreshToken() == null || teacher.getGoogleCalendarRefreshToken().isBlank()) {
                continue;
            }
            AuthenticatedUser principal = principal(teacher);
            List<GroupLessonResponse> lessons;
            try {
                lessons = calendarLessonService.listGroupLessons(principal);
            } catch (RuntimeException ignored) {
                continue;
            }
            for (GroupLessonResponse lesson : lessons) {
                String haystack = normalize(String.join(" ",
                        lesson.title() == null ? "" : lesson.title(),
                        lesson.groupName() == null ? "" : lesson.groupName(),
                        lesson.studentName() == null ? "" : lesson.studentName()));
                if (!normalizedQuery.isBlank() && !haystack.contains(normalizedQuery)) continue;

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("teacherId", teacher.getId().toString());
                item.put("teacherName", teacher.getFullName());
                item.put("eventId", lesson.eventId());
                item.put("bindingKey", lesson.bindingKey());
                item.put("title", lesson.title());
                item.put("groupId", lesson.groupId() == null ? null : lesson.groupId().toString());
                item.put("groupName", lesson.groupName());
                item.put("studentId", lesson.studentId() == null ? null : lesson.studentId().toString());
                item.put("studentName", lesson.studentName());
                item.put("startsAt", lesson.startsAt() == null ? null : lesson.startsAt().toString());
                item.put("endsAt", lesson.endsAt() == null ? null : lesson.endsAt().toString());
                result.add(item);
            }
        }
        return result;
    }

    private List<User> accessibleTeachers(AuthContext auth) {
        if (auth.apiKey() || (auth.user() != null && auth.user().getRole() == Role.ADMIN)) {
            return userRepository.findAllByRoleOrderByFullNameAsc(Role.TEACHER);
        }
        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) {
            return List.of(auth.user());
        }
        return List.of();
    }

    private LessonPreparationResponse getPreparation(Map<String, Object> arguments, AuthContext auth) {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);
        return preparationService.getOrCreate(teacher, eventId);
    }

    private LessonPreparationResponse prepareLesson(Map<String, Object> arguments, AuthContext auth) throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);

        LessonPreparationResponse current = preparationService.getOrCreate(teacher, eventId);
        String homeworkNotes = optional(arguments, "homeworkNotes", current.homeworkNotes());
        String difficulties = optional(arguments, "difficulties", current.difficulties());
        String lessonPlan = optional(arguments, "lessonPlan", current.lessonPlan());

        LessonPreparationResponse result = preparationService.update(
                teacher,
                eventId,
                new UpdateLessonPreparationRequest(homeworkNotes, difficulties, lessonPlan));

        String driveWorkbookFileId = string(arguments.get("driveWorkbookFileId"));
        if (!driveWorkbookFileId.isBlank()) {
            byte[] pdf = googleDriveService.downloadFile(driveWorkbookFileId);
            if (!looksLikePdf(pdf)) throw new IllegalArgumentException("driveWorkbookFileId does not point to a PDF file");
            String filename = string(arguments.get("workbookFilename"));
            if (filename.isBlank()) filename = "lesson-workbook.pdf";
            if (!filename.toLowerCase(Locale.ROOT).endsWith(".pdf")) filename += ".pdf";
            result = preparationService.uploadWorkbook(teacher, eventId, filename, pdf);
        }

        String driveAnswersFileId = string(arguments.get("driveAnswersFileId"));
        if (!driveAnswersFileId.isBlank()) {
            byte[] pdf = googleDriveService.downloadFile(driveAnswersFileId);
            if (!looksLikePdf(pdf)) throw new IllegalArgumentException("driveAnswersFileId does not point to a PDF file");
            String filename = string(arguments.get("answersFilename"));
            if (filename.isBlank()) filename = "lesson-answers.pdf";
            if (!filename.toLowerCase(Locale.ROOT).endsWith(".pdf")) filename += ".pdf";
            result = preparationService.uploadAnswers(teacher, eventId, filename, pdf);
        }
        return result;
    }

    private LessonPreparationResponse attachLessonAnswers(Map<String, Object> arguments, AuthContext auth) throws Exception {
        AuthenticatedUser teacher = requireTeacher(arguments, auth);
        String eventId = required(arguments, "eventId");
        requireLesson(teacher, eventId);

        String driveFileId = required(arguments, "driveFileId");
        byte[] pdf = googleDriveService.downloadFile(driveFileId);
        if (!looksLikePdf(pdf)) throw new IllegalArgumentException("driveFileId does not point to a PDF file");

        String filename = string(arguments.get("filename"));
        if (filename.isBlank()) filename = "lesson-answers.pdf";
        if (!filename.toLowerCase(Locale.ROOT).endsWith(".pdf")) filename += ".pdf";

        return preparationService.uploadAnswers(teacher, eventId, filename, pdf);
    }

    private AuthenticatedUser requireTeacher(Map<String, Object> arguments, AuthContext auth) {
        String teacherId = required(arguments, "teacherId");
        UUID id;
        try {
            id = UUID.fromString(teacherId);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("teacherId must be a UUID");
        }

        if (!auth.apiKey() && auth.user() != null && auth.user().getRole() == Role.TEACHER && !auth.user().getId().equals(id)) {
            throw new IllegalArgumentException("You can access only your own lessons");
        }

        User teacher = userRepository.findById(id)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
        return principal(teacher);
    }

    private AuthenticatedUser principal(User teacher) {
        return new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
    }

    private void requireLesson(AuthenticatedUser teacher, String eventId) {
        boolean exists = calendarLessonService.listGroupLessons(teacher).stream()
                .anyMatch(lesson -> lesson.eventId().equals(eventId));
        if (!exists) throw new IllegalArgumentException("Lesson event was not found in the current calendar window");
    }

    private boolean looksLikePdf(byte[] bytes) {
        return bytes != null && bytes.length >= 5
                && bytes[0] == '%'
                && bytes[1] == 'P'
                && bytes[2] == 'D'
                && bytes[3] == 'F'
                && bytes[4] == '-';
    }

    private AuthContext authenticationContext(String authorization, String suppliedApiKey) {
        String explicitApiKey = suppliedApiKey == null ? "" : suppliedApiKey.trim();
        if (hasValidApiKey(explicitApiKey)) return new AuthContext(true, true, null);

        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            String bearer = authorization.substring(7).trim();
            User oauthUser = oauthService.resolveAccessToken(bearer).orElse(null);
            if (oauthUser != null && (oauthUser.getRole() == Role.ADMIN || oauthUser.getRole() == Role.TEACHER)) {
                return new AuthContext(true, false, oauthUser);
            }
            if (hasValidApiKey(bearer)) return new AuthContext(true, true, null);
        }
        return new AuthContext(false, false, null);
    }

    private boolean hasValidApiKey(String candidate) {
        if (apiKey.isBlank() || candidate == null || candidate.isBlank()) return false;
        byte[] expected = apiKey.getBytes(StandardCharsets.UTF_8);
        byte[] supplied = candidate.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, supplied);
    }

    private Map<String, Object> tool(String name, String description, Map<String, Object> inputSchema, Map<String, Object> annotations) {
        Map<String, Object> tool = new LinkedHashMap<>();
        tool.put("name", name);
        tool.put("description", description);
        tool.put("inputSchema", inputSchema);
        tool.put("annotations", annotations);
        return tool;
    }

    private Map<String, Object> schema(Map<String, Object> properties, List<String> required) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        if (!required.isEmpty()) schema.put("required", required);
        schema.put("additionalProperties", false);
        return schema;
    }

    private Map<String, Object> property(String type, String description) {
        return Map.of("type", type, "description", description);
    }

    private Map<String, Object> toolResult(Object value) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", List.of(Map.of("type", "text", "text", objectMapper.writeValueAsString(value))));
        result.put("structuredContent", value);
        result.put("isError", false);
        return result;
    }

    private Map<String, Object> success(Object id, Object result) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", id);
        response.put("result", result);
        return response;
    }

    private Map<String, Object> error(Object id, int code, String message) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", id);
        response.put("error", Map.of("code", code, "message", message == null ? "Error" : message));
        return response;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        if (value instanceof Map<?, ?> map) return (Map<String, Object>) map;
        return Map.of();
    }

    private String required(Map<String, Object> values, String key) {
        String value = string(values.get(key));
        if (value.isBlank()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private String optional(Map<String, Object> values, String key, String fallback) {
        if (!values.containsKey(key)) return fallback;
        Object raw = values.get(key);
        return raw == null ? null : String.valueOf(raw);
    }

    private String string(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String normalize(String value) {
        return string(value).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private record AuthContext(boolean authenticated, boolean apiKey, User user) {}
}
