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
import java.time.LocalDate;
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
    private static final String SERVER_VERSION = "1.5.1";

    private final String apiKey;
    private final ObjectMapper objectMapper;
    private final UserRepository userRepository;
    private final McpOAuthService oauthService;
    private final GoogleCalendarLessonService calendarLessonService;
    private final LessonPreparationService preparationService;
    private final GoogleDriveService googleDriveService;
    private final McpHomeworkSeriesService homeworkSeriesService;

    public MindcraftiMcpController(
            @Value("${MINDCRAFTI_LESSON_IMPORT_API_KEY:}") String apiKey,
            ObjectMapper objectMapper,
            UserRepository userRepository,
            McpOAuthService oauthService,
            GoogleCalendarLessonService calendarLessonService,
            LessonPreparationService preparationService,
            GoogleDriveService googleDriveService,
            McpHomeworkSeriesService homeworkSeriesService) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
        this.oauthService = oauthService;
        this.calendarLessonService = calendarLessonService;
        this.preparationService = preparationService;
        this.googleDriveService = googleDriveService;
        this.homeworkSeriesService = homeworkSeriesService;
    }

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

        if (notification) return ResponseEntity.accepted().build();

        try {
            Object result = switch (method) {
                case "initialize" -> initialize(body, auth.authenticated());
                case "server/discover" -> discover(auth.authenticated());
                case "ping" -> Map.of();
                case "tools/list" -> Map.of("tools", tools(auth.authenticated()));
                case "tools/call" -> callTool(body, auth);
                default -> null;
            };
            if (result == null) return ResponseEntity.ok(error(id, -32601, "Method not found: " + method));
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
                ? "Mindcrafti school tools: resolve lessons before preparing them; admins can search homework targets across all active teachers without supplying teacherId."
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
                ? "Mindcrafti lesson and homework tools. Resolve the exact target before writing data. Admin target search spans all accessible teachers by default."
                : "Mindcrafti diagnostic MCP connection. No school data is exposed without authentication.");
        return result;
    }

    private List<Map<String, Object>> tools(boolean authenticated) {
        List<Map<String, Object>> tools = new ArrayList<>();
        tools.add(tool(
                "mindcrafti_status",
                "Check that the Mindcrafti MCP server is reachable.",
                schema(Map.of(), List.of()),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));
        if (!authenticated) return tools;

        tools.add(tool(
                "find_lessons",
                "Find upcoming Mindcrafti lessons. Admins can search all connected teacher calendars; teachers can search only their own calendar.",
                schema(Map.of("query", property("string", "Optional student, group, or event title filter.")), List.of()),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        tools.add(tool(
                "get_lesson_preparation",
                "Read workbook, teacher answers, homework notes, difficulties and lesson plan for one lesson.",
                schema(Map.of(
                        "teacherId", property("string", "Teacher UUID returned by find_lessons."),
                        "eventId", property("string", "Google Calendar event ID returned by find_lessons.")), List.of("teacherId", "eventId")),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        Map<String, Object> prepareProperties = new LinkedHashMap<>();
        prepareProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        prepareProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        prepareProperties.put("homeworkNotes", property("string", "Homework completion/status and relevant notes for the teacher."));
        prepareProperties.put("difficulties", property("string", "Observed gaps, recurring errors, or difficulties to address."));
        prepareProperties.put("lessonPlan", property("string", "Concise plan for the lesson."));
        prepareProperties.put("driveWorkbookFileId", property("string", "Optional Google Drive PDF file ID for the workbook."));
        prepareProperties.put("workbookFilename", property("string", "Optional workbook PDF filename."));
        prepareProperties.put("driveAnswersFileId", property("string", "Optional Google Drive PDF file ID for teacher answers."));
        prepareProperties.put("answersFilename", property("string", "Optional teacher-answer PDF filename."));
        tools.add(tool(
                "prepare_lesson",
                "Create or update lesson preparation, optionally copying workbook and teacher-answer PDFs from Google Drive.",
                schema(prepareProperties, List.of("teacherId", "eventId")),
                Map.of("readOnlyHint", false, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        Map<String, Object> answerProperties = new LinkedHashMap<>();
        answerProperties.put("teacherId", property("string", "Teacher UUID returned by find_lessons."));
        answerProperties.put("eventId", property("string", "Google Calendar event ID returned by find_lessons."));
        answerProperties.put("driveFileId", property("string", "Google Drive PDF file ID containing teacher answers."));
        answerProperties.put("filename", property("string", "Optional PDF filename."));
        tools.add(tool(
                "attach_lesson_answers",
                "Copy a teacher-answer PDF from Google Drive into one concrete lesson.",
                schema(answerProperties, List.of("teacherId", "eventId", "driveFileId")),
                Map.of("readOnlyHint", false, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        Map<String, Object> targetProperties = new LinkedHashMap<>();
        targetProperties.put("query", property("string", "Optional student or group name filter, for example Виталина, Christian or Группа 1."));
        targetProperties.put("teacherId", property("string", "Optional teacher UUID. Teachers never need it. Admins may omit it to search across every active teacher."));
        tools.add(tool(
                "find_homework_targets",
                "Find students and groups that can receive homework. Admins search all active teachers by default. Every result includes teacherId and teacherName so it can be used directly for follow-up actions.",
                schema(targetProperties, List.of()),
                Map.of("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)));

        Map<String, Object> seriesProperties = new LinkedHashMap<>();
        seriesProperties.put("teacherId", property("string", "Optional teacher UUID. Teachers never need it. Admins may omit it and Mindcrafti will infer the teacher from targetId when the target is unique."));
        seriesProperties.put("targetType", property("string", "Target type: student or group."));
        seriesProperties.put("targetId", property("string", "Student or group UUID returned by find_homework_targets."));
        seriesProperties.put("startDate", property("string", "First homework date in YYYY-MM-DD format."));
        seriesProperties.put("days", property("integer", "Number of consecutive calendar days to assign, from 1 to 31."));
        seriesProperties.put("driveFileIds", arrayProperty("Google Drive PDF file IDs. Supply one PDF for all days or exactly one PDF per day."));
        seriesProperties.put("filenames", arrayProperty("Optional display filenames: empty, one filename for all days, or one filename per day."));
        tools.add(tool(
                "assign_homework_series",
                "Assign dated PDF homework for several consecutive days to one student or every active student in a group. Admins may omit teacherId when targetId identifies one teacher uniquely. Existing PDF homework on the same student/date is skipped to avoid duplicates.",
                schema(seriesProperties, List.of("targetType", "targetId", "startDate", "days", "driveFileIds")),
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
        if (!auth.authenticated()) throw new IllegalArgumentException("This Mindcrafti tool requires authentication");

        return switch (name) {
            case "find_lessons" -> toolResult(findLessons(string(arguments.get("query")), auth));
            case "get_lesson_preparation" -> toolResult(getPreparation(arguments, auth));
            case "prepare_lesson" -> toolResult(prepareLesson(arguments, auth));
            case "attach_lesson_answers" -> toolResult(attachLessonAnswers(arguments, auth));
            case "find_homework_targets" -> toolResult(findHomeworkTargets(arguments, auth));
            case "assign_homework_series" -> toolResult(assignHomeworkSeries(arguments, auth));
            default -> throw new IllegalArgumentException("Unknown tool: " + name);
        };
    }

    private List<Map<String, Object>> findLessons(String query, AuthContext auth) {
        String normalizedQuery = normalize(query);
        List<Map<String, Object>> result = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived() || teacher.getGoogleCalendarRefreshToken() == null || teacher.getGoogleCalendarRefreshToken().isBlank()) continue;
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
        if (auth.apiKey() || (auth.user() != null && auth.user().getRole() == Role.ADMIN)) return userRepository.findAllByRoleOrderByFullNameAsc(Role.TEACHER);
        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) return List.of(auth.user());
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
        LessonPreparationResponse result = preparationService.update(teacher, eventId,
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

    private Map<String, Object> findHomeworkTargets(Map<String, Object> arguments, AuthContext auth) {
        String query = string(arguments.get("query"));

        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) {
            return homeworkTargetsForTeacher(auth.user(), query);
        }

        String requestedTeacherId = string(arguments.get("teacherId")).trim();
        if (!requestedTeacherId.isBlank()) {
            return homeworkTargetsForTeacher(requireHomeworkTeacher(requestedTeacherId), query);
        }

        List<Map<String, Object>> targets = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived()) continue;
            targets.addAll(homeworkTargetListForTeacher(teacher, query));
        }
        return Map.of("targets", targets);
    }

    private Map<String, Object> homeworkTargetsForTeacher(User teacher, String query) {
        return Map.of("targets", homeworkTargetListForTeacher(teacher, query));
    }

    private List<Map<String, Object>> homeworkTargetListForTeacher(User teacher, String query) {
        Map<String, Object> result = homeworkSeriesService.findTargets(principal(teacher), query);
        List<Map<String, Object>> targets = new ArrayList<>();
        Object rawTargets = result.get("targets");
        if (!(rawTargets instanceof List<?> list)) return targets;

        for (Object rawTarget : list) {
            if (!(rawTarget instanceof Map<?, ?> rawMap)) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : rawMap.entrySet()) {
                item.put(String.valueOf(entry.getKey()), entry.getValue());
            }
            item.put("teacherId", teacher.getId().toString());
            item.put("teacherName", teacher.getFullName());
            targets.add(item);
        }
        return targets;
    }

    private Map<String, Object> assignHomeworkSeries(Map<String, Object> arguments, AuthContext auth) throws Exception {
        String targetType = required(arguments, "targetType");
        UUID targetId = uuid(required(arguments, "targetId"), "targetId");
        AuthenticatedUser teacher = homeworkTeacher(arguments, auth, targetType, targetId);
        LocalDate startDate;
        try {
            startDate = LocalDate.parse(required(arguments, "startDate"));
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("startDate must use YYYY-MM-DD format");
        }
        int days = integer(arguments.get("days"), "days");
        List<String> driveFileIds = stringList(arguments.get("driveFileIds"), "driveFileIds");
        List<String> filenames = arguments.containsKey("filenames") ? stringList(arguments.get("filenames"), "filenames") : List.of();
        return homeworkSeriesService.assignSeries(teacher, targetType, targetId, startDate, days, driveFileIds, filenames);
    }

    private AuthenticatedUser homeworkTeacher(Map<String, Object> arguments, AuthContext auth, String targetType, UUID targetId) {
        if (auth.user() != null && auth.user().getRole() == Role.TEACHER) return principal(auth.user());

        String requestedTeacherId = string(arguments.get("teacherId")).trim();
        if (!requestedTeacherId.isBlank()) return principal(requireHomeworkTeacher(requestedTeacherId));

        List<User> matches = new ArrayList<>();
        for (User teacher : accessibleTeachers(auth)) {
            if (teacher.isArchived()) continue;
            Map<String, Object> result = homeworkSeriesService.findTargets(principal(teacher), "");
            if (containsHomeworkTarget(result, targetType, targetId)) matches.add(teacher);
        }

        if (matches.isEmpty()) {
            throw new IllegalArgumentException("Homework target was not found under any accessible teacher");
        }
        if (matches.size() > 1) {
            throw new IllegalArgumentException("Homework target is ambiguous across teachers; pass teacherId returned by find_homework_targets");
        }
        return principal(matches.get(0));
    }

    private boolean containsHomeworkTarget(Map<String, Object> result, String targetType, UUID targetId) {
        Object rawTargets = result.get("targets");
        if (!(rawTargets instanceof List<?> list)) return false;
        String normalizedType = normalize(targetType);
        String expectedId = targetId.toString();
        for (Object rawTarget : list) {
            if (!(rawTarget instanceof Map<?, ?> rawMap)) continue;
            String type = normalize(string(rawMap.get("type")));
            String id = string(rawMap.get("id"));
            if (normalizedType.equals(type) && expectedId.equals(id)) return true;
        }
        return false;
    }

    private User requireHomeworkTeacher(String teacherId) {
        UUID id = uuid(teacherId, "teacherId");
        return userRepository.findById(id)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
    }

    private AuthenticatedUser requireTeacher(Map<String, Object> arguments, AuthContext auth) {
        String teacherId = required(arguments, "teacherId");
        UUID id = uuid(teacherId, "teacherId");
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
        boolean exists = calendarLessonService.listGroupLessons(teacher).stream().anyMatch(lesson -> lesson.eventId().equals(eventId));
        if (!exists) throw new IllegalArgumentException("Lesson event was not found in the current calendar window");
    }

    private boolean looksLikePdf(byte[] bytes) {
        return bytes != null && bytes.length >= 5 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F' && bytes[4] == '-';
    }

    private AuthContext authenticationContext(String authorization, String suppliedApiKey) {
        String explicitApiKey = suppliedApiKey == null ? "" : suppliedApiKey.trim();
        if (hasValidApiKey(explicitApiKey)) return new AuthContext(true, true, null);
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            String bearer = authorization.substring(7).trim();
            User oauthUser = oauthService.resolveAccessToken(bearer).orElse(null);
            if (oauthUser != null && (oauthUser.getRole() == Role.ADMIN || oauthUser.getRole() == Role.TEACHER)) return new AuthContext(true, false, oauthUser);
            if (hasValidApiKey(bearer)) return new AuthContext(true, true, null);
        }
        return new AuthContext(false, false, null);
    }

    private boolean hasValidApiKey(String candidate) {
        if (apiKey.isBlank() || candidate == null || candidate.isBlank()) return false;
        return MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8), candidate.getBytes(StandardCharsets.UTF_8));
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

    private Map<String, Object> arrayProperty(String description) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("type", "array");
        value.put("description", description);
        value.put("items", Map.of("type", "string"));
        return value;
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

    private UUID uuid(String value, String field) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException(field + " must be a UUID");
        }
    }

    private int integer(Object value, String field) {
        if (value instanceof Number number) return number.intValue();
        try {
            return Integer.parseInt(string(value));
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException(field + " must be an integer");
        }
    }

    private List<String> stringList(Object value, String field) {
        if (!(value instanceof List<?> list)) throw new IllegalArgumentException(field + " must be an array of strings");
        List<String> result = new ArrayList<>();
        for (Object item : list) {
            String text = string(item).trim();
            if (text.isBlank()) throw new IllegalArgumentException(field + " cannot contain blank values");
            result.add(text);
        }
        return result;
    }

    private record AuthContext(boolean authenticated, boolean apiKey, User user) {}
}