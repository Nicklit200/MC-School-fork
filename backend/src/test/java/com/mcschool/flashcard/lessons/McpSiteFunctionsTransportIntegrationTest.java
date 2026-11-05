package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Real HTTP filters, MCP dispatch, method-security proxies and migrated PostgreSQL; no production writes. */
@SpringBootTest(properties = {"app.online-classes.enabled=true", "MINDCRAFTI_LESSON_IMPORT_API_KEY=mcp-test-import-secret",
        "app.online-classes.idle-sweep-initial-ms=86400000"})
@AutoConfigureMockMvc
@EnabledIf("databaseAvailable")
class McpSiteFunctionsTransportIntegrationTest {
    @Autowired private MockMvc http;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private UserRepository users;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private LessonHistoryRepository history;
    @MockitoBean private McpOAuthService oauth;
    @MockitoBean private GoogleCalendarOAuthService googleOAuth;
    @MockitoBean private com.mcschool.flashcard.drive.GoogleDriveStructureService driveStructure;
    @MockitoBean private ChatGptPdfResolver chatGptPdfResolver;
    private User admin, teacherA, teacherB, studentA, studentB;
    private final Map<String, UUID> tokens = new HashMap<>();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        McpTestDatabase.properties(properties);
        properties.add("spring.datasource.hikari.maximum-pool-size", () -> 2);
        properties.add("spring.datasource.hikari.minimum-idle", () -> 0);
    }

    static boolean databaseAvailable() { return McpTestDatabase.available(); }

    @AfterAll
    static void stopDatabase() { McpTestDatabase.stop(); }

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
        JsonNode execute = tools.valueStream().filter(item -> item.path("name").asText().equals("execute_site_function")).findFirst().orElseThrow();
        assertThat(execute.path("_meta").path("openai/fileParams").get(0).asText()).isEqualTo("file");
        assertThat(execute.path("inputSchema").path("properties").path("file").path("required").toString())
                .contains("download_url", "file_id");
        JsonNode state = value(call("admin", "mindcrafti_status", Map.of()));
        assertThat(state.path("version").asText()).isEqualTo("1.30.0");
        assertThat(state.path("availableToolCount").asInt()).isEqualTo(names.size());
        JsonNode catalog = value(call("admin", "list_site_functions", Map.of("limit", 100)));
        assertThat(catalog.path("total").asInt()).isGreaterThan(150);
    }

    @Test
    void sharedChatGptPdfUploadsPersistInTheSelectedSlotAndReplayWithoutRefetching() throws Exception {
        String event = "local-direct-shared-pdf";
        savedLesson(teacherA, event);
        byte[] workbook = transcriptPdf("Shared workbook from ChatGPT");
        byte[] answers = transcriptPdf("Private teacher solutions");
        mockDirectReferenceParser();
        when(chatGptPdfResolver.resolve(any())).thenAnswer(invocation -> {
            ChatGptFileReference reference = invocation.getArgument(0);
            return new PdfInput(reference.filename(), reference.fileId().equals("file-workbook") ? workbook : answers, reference.fileId());
        });
        Map<String, Object> upload = directSharedUpload("lesson_preparation.uploadWorkbook", event, "file-workbook", "shared-workbook-once", "first");
        JsonNode created = value(call("teacher-a", "execute_site_function", upload));
        assertThat(created.path("hasWorkbook").asBoolean()).isTrue();
        assertThat(created.path("success").asBoolean()).isTrue();
        assertThat(created.path("workbookSizeBytes").asLong()).isEqualTo(workbook.length);
        assertThat(created.path("workbookVersion").asLong()).isEqualTo(1);
        assertThat(preparations.findByTeacherIdAndEventId(teacherA.getId(), event).orElseThrow().getWorkbookPdf()).isEqualTo(workbook);
        // A refreshed temporary URL identifies the same attachment and must not cause another fetch.
        Map<String, Object> retry = directSharedUpload("lesson_preparation.uploadWorkbook", event, "file-workbook", "shared-workbook-once", "refreshed");
        assertThat(value(call("teacher-a", "execute_site_function", retry))).isEqualTo(created);
        verify(chatGptPdfResolver, times(1)).resolve(any());
        rejected(call("teacher-a", "execute_site_function", directSharedUpload("lesson_preparation.uploadWorkbook", event,
                "file-different", "shared-workbook-once", "changed")), 409);
        verify(chatGptPdfResolver, times(1)).resolve(any());

        Map<String, Object> answersUpload = new HashMap<>(directSharedUpload("lesson_preparation.uploadAnswers", event,
                "file-answers", "shared-answers-once", "answers"));
        answersUpload.put("teacherId", teacherA.getId().toString());
        JsonNode storedAnswers = value(call("admin", "execute_site_function", answersUpload));
        assertThat(storedAnswers.path("hasAnswers").asBoolean()).isTrue();
        assertThat(storedAnswers.path("answersSizeBytes").asLong()).isEqualTo(answers.length);
        assertThat(storedAnswers.path("answersVersion").asLong()).isEqualTo(1);
        LessonPreparation stored = preparations.findByTeacherIdAndEventId(teacherA.getId(), event).orElseThrow();
        assertThat(stored.getWorkbookPdf()).isEqualTo(workbook);
        assertThat(stored.getAnswersPdf()).isEqualTo(answers);
        JsonNode workbookRead = value(call("teacher-a", "read_site_function", Map.of("functionId", "lesson_preparation.workbook", "arguments", Map.of("eventId", event))));
        JsonNode answersRead = value(call("teacher-a", "read_site_function", Map.of("functionId", "lesson_preparation.answers", "arguments", Map.of("eventId", event))));
        assertThat(java.util.Base64.getDecoder().decode(workbookRead.path("base64").asText())).isEqualTo(workbook);
        assertThat(java.util.Base64.getDecoder().decode(answersRead.path("base64").asText())).isEqualTo(answers);
        assertThat(workbookRead.path("sizeBytes").asInt()).isEqualTo(workbook.length);
        assertThat(answersRead.path("sizeBytes").asInt()).isEqualTo(answers.length);
        verify(chatGptPdfResolver, times(2)).resolve(any());
        assertThat(jdbc.queryForObject("select count(*) from mcp_operation_receipts where operation like 'site_lesson_preparation_upload_%'", Integer.class)).isEqualTo(2);
    }

    @Test
    void prepareLessonReplacesBothAttachedPdfsAtomicallyAndReadbackShowsSizesAndVersions() throws Exception {
        String event = "local-direct-prepare-pair";
        savedLesson(teacherA, event);
        byte[] oldAnswers = transcriptPdf("Previously attached wrong answer PDF");
        LessonPreparation old = LessonPreparation.create(teacherA, event);
        old.attachAnswers("wrong-answers.pdf", oldAnswers);
        preparations.saveAndFlush(old);
        JsonNode initial = value(call("teacher-a", "get_lesson_preparation", Map.of("teacherId", teacherA.getId().toString(), "eventId", event)));
        assertThat(initial.path("hasWorkbook").asBoolean()).isFalse();
        assertThat(initial.path("answersFilename").asText()).isEqualTo("wrong-answers.pdf");
        byte[] workbook = transcriptPdf("New student worksheet");
        byte[] answers = transcriptPdf("New matching teacher solutions");
        byte[] replacementWorkbook = transcriptPdf("Corrected student worksheet");
        byte[] replacementAnswers = transcriptPdf("Corrected teacher solutions");
        mockDirectReferenceParser();
        when(chatGptPdfResolver.resolve(any())).thenAnswer(invocation -> {
            ChatGptFileReference reference = invocation.getArgument(0);
            byte[] bytes = switch (reference.fileId()) {
                case "pair-workbook" -> workbook;
                case "pair-answers" -> answers;
                case "pair-workbook-2" -> replacementWorkbook;
                case "pair-answers-2" -> replacementAnswers;
                case "pair-invalid-answers" -> "%PDF-corrupt".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
                default -> throw new IllegalArgumentException("Unexpected test attachment");
            };
            return new PdfInput(reference.filename(), bytes, reference.fileId());
        });
        Map<String, Object> pair = preparePair(event, "pair-workbook", "pair-answers", "prepare-pair-once", "Saved notes");
        JsonNode saved = value(call("teacher-a", "prepare_lesson", pair));
        assertThat(saved.path("success").asBoolean()).isTrue();
        assertThat(saved.path("hasWorkbook").asBoolean()).isTrue();
        assertThat(saved.path("hasAnswers").asBoolean()).isTrue();
        assertThat(saved.path("workbookSizeBytes").asLong()).isEqualTo(workbook.length);
        assertThat(saved.path("answersSizeBytes").asLong()).isEqualTo(answers.length);
        assertThat(saved.path("workbookVersion").asLong()).isEqualTo(1);
        assertThat(saved.path("answersVersion").asLong()).isEqualTo(2);
        assertThat(value(call("teacher-a", "prepare_lesson", pair))).isEqualTo(saved);
        verify(chatGptPdfResolver, times(2)).resolve(any());

        JsonNode replaced = value(call("teacher-a", "prepare_lesson", preparePair(event,
                "pair-workbook-2", "pair-answers-2", "prepare-corrected-pair", "Corrected notes")));
        assertThat(replaced.path("workbookVersion").asLong()).isEqualTo(2);
        assertThat(replaced.path("answersVersion").asLong()).isEqualTo(3);
        JsonNode readback = value(call("teacher-a", "get_lesson_preparation", Map.of("teacherId", teacherA.getId().toString(), "eventId", event)));
        assertThat(readback.path("workbookSizeBytes").asLong()).isEqualTo(replacementWorkbook.length);
        assertThat(readback.path("answersSizeBytes").asLong()).isEqualTo(replacementAnswers.length);
        assertThat(readback.path("homeworkNotes").asText()).isEqualTo("Corrected notes");
        rejected(call("teacher-a", "prepare_lesson", preparePair(event,
                "pair-workbook", "pair-invalid-answers", "prepare-invalid-pair", "Must not persist")), 400);
        LessonPreparation preserved = preparations.findByTeacherIdAndEventId(teacherA.getId(), event).orElseThrow();
        assertThat(preserved.getWorkbookPdf()).isEqualTo(replacementWorkbook);
        assertThat(preserved.getAnswersPdf()).isEqualTo(replacementAnswers);
        JsonNode afterFailure = value(call("teacher-a", "get_lesson_preparation", Map.of("teacherId", teacherA.getId().toString(), "eventId", event)));
        assertThat(afterFailure.path("homeworkNotes").asText()).isEqualTo("Corrected notes");
        assertThat(afterFailure.path("workbookVersion").asLong()).isEqualTo(2);
        assertThat(afterFailure.path("answersVersion").asLong()).isEqualTo(3);
        assertThat(jdbc.queryForObject("select count(*) from mcp_operation_receipts where operation='prepare_lesson'", Integer.class)).isEqualTo(2);
    }

    @Test
    void directSharedUploadRejectsForeignLessonsUnconfirmedWritesAndAmbiguousSourcesBeforeFetching() throws Exception {
        String event = "local-direct-authority";
        savedLesson(teacherA, event);
        mockDirectReferenceParser();
        Map<String, Object> upload = directSharedUpload("lesson_preparation.uploadWorkbook", event, "file-private", "direct-authority-key", "signature");
        rejected(call("teacher-b", "execute_site_function", upload), 404);
        Map<String, Object> unconfirmed = new HashMap<>(upload); unconfirmed.put("confirm", false);
        rejected(call("teacher-a", "execute_site_function", unconfirmed), 400);
        Map<String, Object> ambiguous = new HashMap<>(upload);
        ambiguous.put("arguments", Map.of("eventId", event, "file", Map.of("filename", "paper.pdf", "contentType", "application/pdf", "base64", "JVBERi0xLjQ=")));
        JsonNode conflict = call("teacher-a", "execute_site_function", ambiguous);
        rejected(conflict, 400);
        assertThat(conflict.toString()).contains("exactly_one_source_required");
        verify(chatGptPdfResolver, never()).resolve(any());
        assertThat(preparations.findByTeacherIdAndEventId(teacherA.getId(), event)).isEmpty();
        assertThat(jdbc.queryForObject("select count(*) from mcp_operation_receipts", Integer.class)).isZero();
    }

    private void mockDirectReferenceParser() {
        when(chatGptPdfResolver.reference(any(), anyString(), nullable(String.class), anyString())).thenAnswer(invocation -> {
            Map<?, ?> file = invocation.getArgument(0);
            return new ChatGptFileReference((String) file.get("download_url"), (String) file.get("file_id"),
                    "application/pdf", file.containsKey("file_name") ? (String) file.get("file_name") : "paper.pdf");
        });
    }

    private Map<String, Object> preparePair(String event, String workbookId, String answersId, String key, String notes) {
        return Map.of("teacherId", teacherA.getId().toString(), "eventId", event, "homeworkNotes", notes,
                "workbookFile", Map.of("download_url", "https://files.oaiusercontent.com/attachment?sig=workbook", "file_id", workbookId, "file_name", "workbook.pdf"),
                "answersFile", Map.of("download_url", "https://files.oaiusercontent.com/attachment?sig=answers", "file_id", answersId, "file_name", "answers.pdf"),
                "idempotencyKey", key);
    }

    private Map<String, Object> directSharedUpload(String function, String event, String fileId, String key, String signature) {
        return Map.of("functionId", function, "arguments", Map.of("eventId", event), "confirm", true, "idempotencyKey", key,
                "file", Map.of("download_url", "https://files.oaiusercontent.com/attachment?sig=" + signature,
                        "file_id", fileId, "mime_type", "application/pdf", "file_name", "paper.pdf"));
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
    void privateStudioCollectionSavesLargeExactProjectAndReadbackAndRetryPreserveEveryTemplate() throws Exception {
        String project = studioProject("x".repeat(210000));
        JsonNode schema = value(call("admin", "get_site_function", Map.of("functionId", "stories_studio.save")));
        assertThat(schema.path("argumentsSchema").path("properties").path("body").path("properties")
                .path("projectJson").path("maxLength").asInt()).isEqualTo(1900000);
        Map<String, Object> save = studioSave(0, project, "studio-create-collection");
        JsonNode created = value(call("admin", "execute_site_function", save));
        assertThat(created.path("version").asInt()).isEqualTo(1);
        assertThat(created.has("projectJson")).isFalse();
        assertThat(value(call("admin", "execute_site_function", save))).isEqualTo(created);
        assertThat(studioReadback("admin", created)).isEqualTo(project);
        assertThat(jdbc.queryForObject("select revision from story_studio_projects where owner_id=?", Long.class, admin.getId())).isEqualTo(1L);
        assertThat(jdbc.queryForObject("select count(*) from mcp_operation_receipts where actor_id=?", Long.class, admin.getId())).isEqualTo(1L);
        String updated = project.replace("\"activeTemplateId\":\"template-2\"", "\"activeTemplateId\":\"template-1\"");
        JsonNode next = value(call("admin", "execute_site_function", studioSave(1, updated, "studio-select-news-template")));
        assertThat(next.path("version").asInt()).isEqualTo(2);
        assertThat(studioReadback("admin", next)).isEqualTo(updated);
        rejected(call("admin", "read_site_function", Map.of("functionId", "stories_studio.chunk",
                "arguments", Map.of("version", 1, "chunkIndex", 0))), 409);
        rejected(call("admin", "execute_site_function", studioSave(0, project, "studio-stale-create")), 409);
        Map<String, Object> unconfirmed = new HashMap<>(studioSave(2, updated, "studio-unconfirmed")); unconfirmed.put("confirm", false);
        rejected(call("admin", "execute_site_function", unconfirmed), 400);
        rejected(call("admin", "read_site_function", Map.of("functionId", "stories_studio.save", "arguments", save.get("arguments"))), 400);
        String stored = jdbc.queryForObject("select project_json from story_studio_projects where owner_id=?", String.class, admin.getId());
        assertThat(stored).isEqualTo(updated).contains("\"name\":\"Новости\"", "\"name\":\"Результаты\"", "original-unknown-field", "data:image/webp;base64,YQ==");
    }

    @Test
    void privateStudioSaveIsAdminOnlyAndEachAdministratorHasAnIndependentOwnerAndVersion() throws Exception {
        String project = studioProject("private-original");
        JsonNode original = value(call("admin", "execute_site_function", studioSave(0, project, "studio-own-private-save")));
        rejected(call("teacher-a", "get_site_function", Map.of("functionId", "stories_studio.save")), 404);
        rejected(call("teacher-a", "execute_site_function", studioSave(0, project, "teacher-cannot-save")), 404);
        rejected(call("mcp-test-import-secret", "execute_site_function", studioSave(0, project, "import-cannot-save")), 403);
        User other = users.save(User.bootstrapAdmin("Other admin", "other-studio@test.local", "unused")); tokens.put("other-admin", other.getId());
        JsonNode otherInfo = value(call("other-admin", "read_site_function", Map.of("functionId", "stories_studio.info", "arguments", Map.of())));
        assertThat(otherInfo.path("configured").asBoolean()).isFalse();
        rejected(call("other-admin", "read_site_function", Map.of("functionId", "stories_studio.chunk", "arguments", Map.of("version", 1, "chunkIndex", 0))), 404);
        rejected(call("other-admin", "execute_site_function", studioSave(1, studioProject("foreign-change"), "studio-wrong-owner-version")), 409);
        Map<String, Object> forged = new HashMap<>(studioSave(0, project, "studio-forged-owner"));
        forged.put("arguments", Map.of("ownerId", admin.getId().toString(), "body", Map.of("expectedVersion", 0, "projectJson", project)));
        rejected(call("other-admin", "execute_site_function", forged), 400);
        String otherProject = studioProject("other-admin-draft");
        JsonNode otherSaved = value(call("other-admin", "execute_site_function", studioSave(0, otherProject, "studio-own-private-save")));
        assertThat(studioReadback("other-admin", otherSaved)).isEqualTo(otherProject);
        assertThat(studioReadback("admin", original)).isEqualTo(project);
        assertThat(jdbc.queryForObject("select count(*) from story_studio_projects", Long.class)).isEqualTo(2L);
    }

    @Test
    void concurrentStudioSavesWithTheSameExpectedVersionHaveExactlyOneWinner() throws Exception {
        value(call("admin", "execute_site_function", studioSave(0, studioProject("initial"), "studio-concurrent-initial")));
        String first = studioProject("first-concurrent"), second = studioProject("second-concurrent");
        var executor = Executors.newFixedThreadPool(2);
        var start = new CountDownLatch(1);
        JsonNode one, two;
        try {
            var left = executor.submit(() -> { start.await(); return call("admin", "execute_site_function", studioSave(1, first, "studio-concurrent-first")); });
            var right = executor.submit(() -> { start.await(); return call("admin", "execute_site_function", studioSave(1, second, "studio-concurrent-second")); });
            start.countDown(); one = left.get(30, TimeUnit.SECONDS); two = right.get(30, TimeUnit.SECONDS);
        } finally { executor.shutdownNow(); }
        assertThat(List.of(one, two).stream().filter(result -> result.path("isError").asBoolean()).count()).isEqualTo(1);
        JsonNode winner = one.path("isError").asBoolean() ? two : one;
        rejected(one.path("isError").asBoolean() ? one : two, 409);
        assertThat(value(winner).path("version").asInt()).isEqualTo(2);
        JsonNode info = value(call("admin", "read_site_function", Map.of("functionId", "stories_studio.info", "arguments", Map.of())));
        assertThat(studioReadback("admin", info)).isIn(first, second);
        assertThat(jdbc.queryForObject("select revision from story_studio_projects where owner_id=?", Long.class, admin.getId())).isEqualTo(2L);
        assertThat(jdbc.queryForObject("select count(*) from mcp_operation_receipts where actor_id=?", Long.class, admin.getId())).isEqualTo(2L);
    }

    private static String studioProject(String extra) {
        return "{\"schema\":\"mindcrafti.story-studio/2\",\"activeTemplateId\":\"template-2\","
                + "\"assets\":{\"logoSrc\":\"data:image/webp;base64,YQ==\"},\"templates\":["
                + "{\"id\":\"template-1\",\"name\":\"Новости\",\"story\":{\"custom\":\"original-unknown-field\"},\"css\":\".original{}\",\"html\":\"<b>Original</b>\"},"
                + "{\"id\":\"template-2\",\"name\":\"Результаты\",\"story\":{\"extra\":\"" + extra + "\"},\"css\":\".progress{}\",\"html\":\"<b>Progress</b>\"}]}";
    }

    private static Map<String, Object> studioSave(long expectedVersion, String project, String key) {
        return Map.of("functionId", "stories_studio.save", "arguments", Map.of("body", Map.of("expectedVersion", expectedVersion, "projectJson", project)),
                "confirm", true, "idempotencyKey", key);
    }

    private String studioReadback(String actor, JsonNode metadata) throws Exception {
        var output = new ByteArrayOutputStream();
        for (int index = 0; index < metadata.path("chunkCount").asInt(); index++) {
            JsonNode chunk = value(call(actor, "read_site_function", Map.of("functionId", "stories_studio.chunk", "arguments",
                    Map.of("version", metadata.path("version").asLong(), "chunkIndex", index))));
            assertThat(chunk.path("sha256").asText()).isEqualTo(metadata.path("sha256").asText());
            output.writeBytes(java.util.Base64.getDecoder().decode(chunk.path("base64").asText()));
        }
        String digest = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(output.toByteArray()));
        assertThat(digest).isEqualTo(metadata.path("sha256").asText());
        return output.toString(java.nio.charset.StandardCharsets.UTF_8);
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
