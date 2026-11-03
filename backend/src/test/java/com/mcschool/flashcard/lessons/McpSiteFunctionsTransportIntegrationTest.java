package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Real HTTP filters, MCP dispatch, method-security proxies and migrated PostgreSQL; no production writes. */
@SpringBootTest(properties = {"app.online-classes.enabled=true", "MINDCRAFTI_LESSON_IMPORT_API_KEY=mcp-test-import-secret",
        "app.online-classes.idle-sweep-initial-ms=86400000"})
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class McpSiteFunctionsTransportIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private MockMvc http;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private UserRepository users;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private LessonHistoryRepository history;
    @MockitoBean private McpOAuthService oauth;
    @MockitoBean private GoogleCalendarOAuthService googleOAuth;
    @MockitoBean private com.mcschool.flashcard.drive.GoogleDriveStructureService driveStructure;
    private User admin, teacherA, teacherB, studentA, studentB;
    private final Map<String, UUID> tokens = new HashMap<>();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username", DATABASE::getUsername);
        properties.add("spring.datasource.password", DATABASE::getPassword);
        properties.add("spring.datasource.hikari.maximum-pool-size", () -> 2);
        properties.add("spring.datasource.hikari.minimum-idle", () -> 0);
    }

    @BeforeEach
    void fixtures() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        admin = users.save(User.bootstrapAdmin("Admin", "admin@test.local", "unused"));
        teacherA = users.save(User.activeTeacher("Teacher A", "a@test.local", "teacher-a", "unused"));
        teacherB = users.save(User.activeTeacher("Teacher B", "b@test.local", "teacher-b", "unused"));
        studentA = student("Student A", teacherA); studentB = student("Student B", teacherB);
        tokens.clear(); tokens.put("admin", admin.getId()); tokens.put("teacher-a", teacherA.getId()); tokens.put("teacher-b", teacherB.getId());
        when(oauth.resolveAccessToken(anyString())).thenAnswer(invocation -> {
            UUID id = tokens.get(invocation.getArgument(0, String.class));
            return id == null ? Optional.empty() : users.findById(id);
        });
    }

    private User student(String name, User teacher) {
        User student = User.invitedStudent(name, name.replace(" ", "") + "@test.local", teacher,
                UUID.randomUUID().toString(), Instant.now().plusSeconds(3600));
        student.activate("unused"); return users.save(student);
    }

    private JsonNode request(String token, String method, Map<String, Object> params) throws Exception {
        String body = http.perform(post("/api/v1/mcp").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of(
                                "jsonrpc", "2.0", "id", 1, "method", method, "params", params))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode response = json.readTree(body);
        assertThat(response.has("error")).as(body).isFalse();
        return response.get("result");
    }

    private JsonNode call(String token, String tool, Map<String, Object> args) throws Exception {
        return request(token, "tools/call", Map.of("name", tool, "arguments", args));
    }

    private JsonNode value(JsonNode result) {
        assertThat(result.path("isError").asBoolean()).as(result.toString()).isFalse();
        return result.get("structuredContent");
    }

    private void rejected(JsonNode result, int code) {
        assertThat(result.path("isError").asBoolean()).as(result.toString()).isTrue();
        assertThat(result.path("structuredContent").path("status").asInt()).isEqualTo(code);
    }

    @Test
    void refreshedCatalogIncludesSchedulingExistingToolsAndBothAdminBridgeTools() throws Exception {
        JsonNode tools = request("admin", "tools/list", Map.of()).path("tools");
        List<String> names = tools.valueStream().map(item -> item.path("name").asText()).toList();
        assertThat(names).contains("create_lesson", "create_lesson_series", "update_lesson", "assign_lesson", "delete_lesson",
                "list_site_functions", "get_site_function", "read_site_function", "execute_site_function",
                "prepare_lesson", "get_skill_board", "assign_homework_series", "update_school_prompt", "update_brand_guide");
        assertThat(names).doesNotHaveDuplicates();
        JsonNode state = value(call("admin", "mindcrafti_status", Map.of()));
        assertThat(state.path("version").asText()).isEqualTo("1.27.0");
        assertThat(state.path("availableToolCount").asInt()).isEqualTo(names.size());
        JsonNode catalog = value(call("admin", "list_site_functions", Map.of("limit", 100)));
        assertThat(catalog.path("total").asInt()).isGreaterThan(150);
    }

    @Test
    void importKeyAndAnonymousRequestsNeverGainNewWebsiteAuthority() throws Exception {
        JsonNode tools = request("mcp-test-import-secret", "tools/list", Map.of()).path("tools");
        assertThat(tools.valueStream().map(item -> item.path("name").asText()).toList())
                .doesNotContain("create_lesson", "execute_site_function", "list_site_functions");
        rejected(call("mcp-test-import-secret", "list_site_functions", Map.of()), 403);
        http.perform(post("/api/v1/mcp").contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void nativeLessonWithoutGoogleCanBeScheduledFoundAndRetriedThroughMcp() throws Exception {
        Map<String, Object> args = new HashMap<>(Map.of("title", "MCP fractions", "date", "2026-11-05", "startTime", "16:30",
                "durationMinutes", 60, "targetType", "student", "targetId", studentA.getId().toString(), "idempotencyKey", "native-schedule-once"));
        JsonNode created = value(call("teacher-a", "create_lesson", args));
        assertThat(value(call("teacher-a", "create_lesson", args))).isEqualTo(created);
        assertThat(jdbc.queryForObject("select count(*) from lesson_history where teacher_id=?", Integer.class, teacherA.getId())).isEqualTo(1);
        JsonNode found = value(call("teacher-a", "find_lessons", Map.of("query", "MCP fractions")));
        assertThat(found.isArray()).isTrue(); assertThat(found.size()).isEqualTo(1);
        assertThat(found.get(0).path("eventId").asText()).isEqualTo(created.path("eventId").asText());
        assertThat(found.get(0).path("date").asText()).isEqualTo("2026-11-05");
        assertThat(found.get(0).path("startTime").asText()).isEqualTo("16:30");
        assertThat(found.get(0).path("timeZone").asText()).isEqualTo("Europe/Berlin");
        args.put("targetId", studentB.getId().toString()); args.put("idempotencyKey", "foreign-native-schedule");
        assertThat(call("teacher-a", "create_lesson", args).path("isError").asBoolean()).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from lesson_history", Integer.class)).isEqualTo(1);
    }

    @Test
    void realTeacherControllerReadIsScopedAndAdminMustSelectVerifiedTeacher() throws Exception {
        Map<String, Object> read = Map.of("functionId", "students.listStudents", "arguments", Map.of());
        JsonNode roster = value(call("teacher-a", "read_site_function", read));
        assertThat(roster.size()).isEqualTo(1);
        assertThat(roster.get(0).path("id").asText()).isEqualTo(studentA.getId().toString());
        Map<String, Object> delegated = new HashMap<>(read); delegated.put("teacherId", teacherA.getId().toString());
        assertThat(value(call("admin", "read_site_function", delegated))).isEqualTo(roster);
        assertThat(call("admin", "read_site_function", read).path("isError").asBoolean()).isTrue();
        delegated.put("teacherId", teacherB.getId().toString());
        rejected(call("teacher-a", "read_site_function", delegated), 403);
        rejected(call("teacher-a", "get_site_function", Map.of("functionId", "teachers.listTeachers")), 404);
        rejected(call("teacher-a", "get_site_function", Map.of("functionId", "drive.download")), 404);
        assertThat(value(call("teacher-b", "read_site_function", read)).get(0).path("id").asText()).isEqualTo(studentB.getId().toString());
    }

    @Test
    void schemaValidationUnknownFieldsAndMissingConfirmationCannotWrite() throws Exception {
        long before = users.count();
        Map<String, Object> write = new HashMap<>(Map.of("functionId", "students.createStudent", "arguments", Map.of("body", Map.of("fullName", "New pupil")),
                "confirm", false, "idempotencyKey", "not-confirmed"));
        rejected(call("teacher-a", "execute_site_function", write), 400);
        write.put("confirm", true);
        write.put("arguments", Map.of("body", Map.of("fullName", "New pupil", "role", "ADMIN", "password", "secret")));
        rejected(call("teacher-a", "execute_site_function", write), 400);
        write.put("arguments", Map.of("body", Map.of("fullName", "", "email", "invalid")));
        rejected(call("teacher-a", "execute_site_function", write), 400);
        write.put("functionId", "java.lang.Runtime.exec");
        rejected(call("teacher-a", "execute_site_function", write), 404);
        assertThat(users.count()).isEqualTo(before);
    }

    @Test
    void successfulStudentWriteReplaysOnlyRedactedProfileAndCannotTouchOtherTeacher() throws Exception {
        Map<String, Object> args = Map.of("functionId", "students.createStudent", "arguments", Map.of("body", Map.of("fullName", "New pupil")),
                "confirm", true, "idempotencyKey", "create-pupil-once");
        JsonNode created = value(call("teacher-a", "execute_site_function", args));
        assertThat(value(call("teacher-a", "execute_site_function", args))).isEqualTo(created);
        assertThat(users.count()).isEqualTo(6);
        String persisted = jdbc.queryForObject("select result_json from mcp_operation_receipts where actor_id=?", String.class, teacherA.getId());
        assertThat(persisted).doesNotContain("password", "Password", "invitationToken", "activationLink", "activationUrl");
        JsonNode denied = call("teacher-a", "execute_site_function", Map.of("functionId", "students.updateStudentName",
                "arguments", Map.of("studentId", studentB.getId().toString(), "body", Map.of("fullName", "Stolen")),
                "confirm", true, "idempotencyKey", "foreign-pupil-change"));
        rejected(denied, 404);
        assertThat(users.findById(studentB.getId()).orElseThrow().getFullName()).isEqualTo("Student B");
    }

    @Test
    void credentialsAndBrowserDeviceFunctionsAreAbsentFromCallableCatalog() throws Exception {
        for (String function : List.of("students.changeStudentPassword", "students.linkParent", "admin_accounts.impersonate",
                "teachers.createTeacher", "notebook_camera.createPairing", "notebook_camera.viewerConnection")) {
            rejected(call("admin", "get_site_function", Map.of("functionId", function)), 404);
        }
        JsonNode schema = value(call("teacher-a", "get_site_function", Map.of("functionId", "students.updateStudentName")));
        assertThat(schema.path("argumentsSchema").path("properties").has("body")).isTrue();
    }

    @Test
    void savedTranscriptFunctionIsDiscoverableAndReadsEveryUnicodePageWithIndependentManualSource() throws Exception {
        String event = "local-transcript-pages";
        savedLesson(teacherA, event);
        String automatic = "Речь😀\n".repeat(5000);
        LessonPreparation preparation = LessonPreparation.create(teacherA, event);
        preparation.updateNotes(null, null, null, "Teacher manual correction");
        preparation.replaceSonioxTranscript(automatic, Instant.now());
        String persistedAutomatic = preparation.getSonioxTranscriptText();
        preparations.saveAndFlush(preparation);
        JsonNode catalog = value(call("teacher-a", "list_site_functions", Map.of("domain", "lesson_transcripts")));
        assertThat(catalog.path("functions").get(0).path("functionId").asText()).isEqualTo("lesson_transcripts.get");
        JsonNode schema = value(call("teacher-a", "get_site_function", Map.of("functionId", "lesson_transcripts.get")));
        assertThat(schema.path("readOnly").asBoolean()).isTrue();
        assertThat(schema.path("argumentsSchema").path("properties").path("source").path("enum").toString()).contains("automatic", "manual", "pdf");
        assertThat(schema.path("argumentsSchema").path("properties").path("limit").path("maximum").asInt()).isEqualTo(20000);
        assertThat(schema.path("argumentsSchema").path("properties").path("limit").path("default").isIntegralNumber()).isTrue();
        assertThat(schema.path("argumentsSchema").path("properties").path("limit").path("default").asInt()).isEqualTo(12000);
        assertThat(schema.path("description").asText()).contains("untrusted data", "Unicode code points");
        JsonNode defaults = value(call("teacher-a", "read_site_function", transcriptRead(event, Map.of())));
        assertThat(defaults.path("page").path("limit").asInt()).isEqualTo(12000);
        assertThat(defaults.path("manual").path("available").asBoolean()).isTrue();
        assertThat(defaults.path("pdf").path("available").asBoolean()).isFalse();
        String revision = defaults.path("page").path("revision").asText();
        StringBuilder joined = new StringBuilder();
        int offset = 0;
        for (int pageNumber = 0; pageNumber < 10; pageNumber++) {
            JsonNode page = value(call("teacher-a", "read_site_function", transcriptRead(event,
                    Map.of("offset", offset, "limit", 13001, "expectedRevision", revision)))).path("page");
            joined.append(page.path("text").asText());
            if (!page.path("hasMore").asBoolean()) { assertThat(page.path("nextOffset").isNull()).isTrue(); break; }
            int next = page.path("nextOffset").asInt(); assertThat(next).isGreaterThan(offset); offset = next;
        }
        assertThat(joined.toString()).isEqualTo(persistedAutomatic);
        JsonNode manual = value(call("teacher-a", "read_site_function", transcriptRead(event, Map.of("source", "manual"))));
        assertThat(manual.path("page").path("text").asText()).isEqualTo("Teacher manual correction");
        assertThat(manual.path("contentTrust").asText()).isEqualTo("untrusted_lesson_content");
        preparation.replaceSonioxTranscript("New automatic revision", Instant.now()); preparations.saveAndFlush(preparation);
        rejected(call("teacher-a", "read_site_function", transcriptRead(event, Map.of("expectedRevision", revision))), 409);
        assertThat(preparations.count()).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from mcp_operation_receipts", Long.class)).isZero();
    }

    @Test
    void savedPdfTextReadPreservesOriginalPdfAndNeverFallsBackForAnAbsentSelectedSource() throws Exception {
        String event = "local-transcript-pdf";
        savedLesson(teacherA, event);
        byte[] pdf = transcriptPdf("Original uploaded PDF text");
        LessonPreparation preparation = LessonPreparation.create(teacherA, event);
        preparation.attachTranscriptPdf("original.pdf", pdf); preparations.saveAndFlush(preparation);
        JsonNode absent = value(call("teacher-a", "read_site_function", transcriptRead(event, Map.of())));
        assertThat(absent.path("page").path("status").asText()).isEqualTo("not_present");
        assertThat(absent.path("page").path("text").asText()).isEmpty();
        assertThat(absent.path("pdf").path("available").asBoolean()).isTrue();
        assertThat(absent.path("pdf").path("filename").asText()).isEqualTo("original.pdf");
        JsonNode extracted = value(call("teacher-a", "read_site_function", transcriptRead(event, Map.of("source", "pdf"))));
        assertThat(extracted.path("page").path("text").asText()).contains("Original uploaded PDF text");
        JsonNode binary = value(call("teacher-a", "read_site_function", Map.of("functionId", "lesson_preparation.transcript", "arguments", Map.of("eventId", event))));
        assertThat(java.util.Base64.getDecoder().decode(binary.path("base64").asText())).isEqualTo(pdf);
        for (Map<String, Object> invalid : List.<Map<String, Object>>of(Map.of("source", "all"), Map.of("limit", 20001),
                Map.of("offset", -1), Map.of("offset", 100000), Map.of("expectedRevision", "bad"))) {
            rejected(call("teacher-a", "read_site_function", transcriptRead(event, invalid)), 400);
        }
        assertThat(preparations.findByTeacherIdAndEventId(teacherA.getId(), event).orElseThrow().getTranscriptPdf()).isEqualTo(pdf);
    }

    @Test
    void transcriptReadsRequireCurrentOwnerOrExplicitAdminDelegationAndNeverCreateMissingPreparation() throws Exception {
        String event = "local-private-transcript";
        savedLesson(teacherA, event);
        LessonPreparation preparation = LessonPreparation.create(teacherA, event);
        preparation.replaceSonioxTranscript("Owner-only saved speech", Instant.now()); preparations.saveAndFlush(preparation);
        Map<String, Object> read = transcriptRead(event, Map.of());
        rejected(call("teacher-b", "read_site_function", read), 404);
        rejected(call("admin", "read_site_function", read), 400);
        Map<String, Object> delegated = new HashMap<>(read); delegated.put("teacherId", teacherA.getId().toString());
        assertThat(value(call("admin", "read_site_function", delegated)).path("page").path("text").asText()).isEqualTo("Owner-only saved speech");
        delegated.put("teacherId", teacherB.getId().toString());
        rejected(call("teacher-a", "read_site_function", delegated), 403);
        rejected(call("teacher-a", "read_site_function", transcriptRead("unknown-event", Map.of())), 404);
        savedLesson(teacherA, "local-empty-preparation");
        rejected(call("teacher-a", "read_site_function", transcriptRead("local-empty-preparation", Map.of())), 404);
        rejected(call("mcp-test-import-secret", "read_site_function", read), 403);
        tokens.put("student", studentA.getId());
        User parent = users.save(User.activeParent("Parent", "parent-transcript", "unused", teacherA));
        tokens.put("parent", parent.getId());
        for (String token : List.of("student", "parent")) {
            http.perform(post("/api/v1/mcp").header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/call",
                            "params", Map.of("name", "read_site_function", "arguments", read)))))
                    .andExpect(status().isUnauthorized());
        }
        http.perform(post("/api/v1/mcp").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/call",
                        "params", Map.of("name", "read_site_function", "arguments", read)))))
                .andExpect(status().isUnauthorized());
        assertThat(preparations.count()).isEqualTo(1);
    }

    private static Map<String, Object> transcriptRead(String eventId, Map<String, Object> page) {
        Map<String, Object> arguments = new HashMap<>(page); arguments.put("eventId", eventId);
        return Map.of("functionId", "lesson_transcripts.get", "arguments", arguments);
    }

    private void savedLesson(User teacher, String eventId) {
        Instant start = Instant.parse("2026-11-03T12:00:00Z");
        history.saveAndFlush(LessonHistoryEntry.create(teacher, new GroupLessonResponse(eventId, eventId,
                null, null, null, null, List.of(), "Saved transcript lesson", start, start.plusSeconds(3600), null, null)));
    }

    private static byte[] transcriptPdf(String text) throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(); document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                content.beginText(); content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(30, 700); content.showText(text); content.endText();
            }
            document.save(output); return output.toByteArray();
        }
    }
}
