package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.doReturn;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.drive.TeacherGoogleDriveDownloadService;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanService;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import com.mcschool.flashcard.settings.SchoolPromptSettingsService;
import com.mcschool.flashcard.settings.StoryTemplateDownloadLinkService;
import com.mcschool.flashcard.settings.StoryTemplateMasterService;
import com.mcschool.flashcard.trialleads.FunnelAnalyticsService;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

class McpPersonalLessonWorkbookToolsTest {
    private final ObjectMapper json = new ObjectMapper();
    private final UserRepository users = mock(UserRepository.class);
    private final McpOAuthService oauth = mock(McpOAuthService.class);
    private final PersonalLessonWorkbookService personal = mock(PersonalLessonWorkbookService.class);
    private final PersonalLessonAnswersService personalAnswers = mock(PersonalLessonAnswersService.class);
    private final McpAccessService access = mock(McpAccessService.class);
    private final McpOperationReceiptService receipts = mock(McpOperationReceiptService.class);
    private final LessonPreparationService shared = mock(LessonPreparationService.class);
    private final TeacherGoogleDriveDownloadService drive = mock(TeacherGoogleDriveDownloadService.class);
    private MindcraftiMcpController controller;
    private User owner, admin, otherTeacher;
    private AuthenticatedUser teacher;
    private final UUID studentId = UUID.randomUUID();
    private static final String EVENT = "exact-lesson-event";

    @BeforeEach
    void setUp() {
        owner = User.activeTeacher("Nick", "nick@test.local", "nick", "unused");
        ReflectionTestUtils.setField(owner, "id", AiLessonPilotService.PILOT_TEACHER_ID);
        admin = User.bootstrapAdmin("Admin", "admin@test.local", "unused");
        otherTeacher = User.activeTeacher("Other", "other@test.local", "other", "unused");
        teacher = principal(owner);
        when(oauth.resolveAccessToken("owner")).thenReturn(Optional.of(owner));
        when(oauth.resolveAccessToken("admin")).thenReturn(Optional.of(admin));
        when(oauth.resolveAccessToken("other")).thenReturn(Optional.of(otherTeacher));
        when(oauth.resolveAccessToken("student")).thenReturn(Optional.of(User.managedStudent("Student", owner)));
        when(access.requireActor(owner)).thenReturn(teacher);
        when(access.requireActor(admin)).thenReturn(principal(admin));
        when(access.requireTeacher(any(), eq(owner.getId()))).thenReturn(teacher);
        when(personal.list(teacher, EVENT)).thenReturn(new PersonalLessonWorkbookService.PersonalWorkbooksResponse(
                true, List.of(new PersonalLessonWorkbookService.PersonalWorkbookResponse(studentId, "Student", false, null, 0L))));
        controller = new MindcraftiMcpController("import-key", json, users, oauth,
                mock(GoogleCalendarLessonService.class), shared, mock(LessonPreparationRepository.class),
                mock(TranscriptLessonGuard.class), drive, mock(McpHomeworkSeriesService.class),
                mock(McpAnalyticsService.class), mock(McpHomeworkReadService.class), mock(McpHomeworkWriteService.class),
                mock(MonthlyPlanService.class), mock(SchoolPromptSettingsService.class), mock(SchoolBrandGuideService.class),
                mock(LessonPdfDraftService.class), mock(StoryTemplateMasterService.class),
                mock(StoryTemplateDownloadLinkService.class), mock(FunnelAnalyticsService.class));
        controller.setPersonalLessonWorkbookService(personal);
        controller.setPersonalLessonAnswersService(personalAnswers);
        controller.setPersonalWorkbookAccess(access);
        controller.setPersonalWorkbookReceipts(receipts);
    }

    @Test
    void catalogExposesPilotToolsToOwnerAndAdministratorsButNotOtherTeachersOrImportKey() {
        for (String token : List.of("owner", "admin")) {
            assertThat(toolNames(token)).contains("list_personal_lesson_workbooks", "upload_personal_lesson_workbook", "upload_personal_lesson_answers");
        }
        for (String token : List.of("other", "import-key", "student")) {
            assertThat(toolNames(token)).doesNotContain("list_personal_lesson_workbooks", "upload_personal_lesson_workbook", "upload_personal_lesson_answers");
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void catalogDescribesPrivatePriorityInMyBoardAndPreservedAnnotationScope() {
        Map<String, Object> catalog = request("owner", "tools/list", Map.of());
        List<Map<String, Object>> tools = (List<Map<String, Object>>) catalog.get("tools");
        String description = tools.stream().filter(tool -> "upload_personal_lesson_workbook".equals(tool.get("name")))
                .map(tool -> String.valueOf(tool.get("description"))).findFirst().orElseThrow();
        assertThat(description).contains("My board (Моя доска)", "takes priority over the common workbook",
                "personal-workbook-<studentUserId>", "other pupils are unchanged", "common-workbook annotations remain separate");
        assertThat(description).doesNotContain("separate Personal worksheet tab", "Персональный лист");
        String common = tools.stream().filter(tool -> "prepare_lesson".equals(tool.get("name")))
                .map(tool -> String.valueOf(tool.get("description"))).findFirst().orElseThrow();
        assertThat(common).contains("Shared board", "My board unless that pupil has a private worksheet", "Private worksheets and their annotations are preserved");
        String download = tools.stream().filter(tool -> "download_lesson_pdf".equals(tool.get("name")))
                .map(tool -> String.valueOf(tool.get("description"))).findFirst().orElseThrow();
        assertThat(download).contains("common workbook", "does not select a pupil's private worksheet or private answers");
    }

    @Test
    @SuppressWarnings("unchecked")
    void catalogDeclaresOfficialTopLevelFileParametersAndExclusivePdfSources() {
        List<Map<String, Object>> catalog = (List<Map<String, Object>>) request("owner", "tools/list", Map.of()).get("tools");
        for (String name : List.of("upload_personal_lesson_workbook", "upload_personal_lesson_answers")) {
            Map<String, Object> tool = catalog.stream().filter(item -> name.equals(item.get("name"))).findFirst().orElseThrow();
            assertThat((Map<String, Object>) tool.get("_meta")).containsEntry("openai/fileParams", List.of("pdfFile"));
            Map<String, Object> schema = (Map<String, Object>) tool.get("inputSchema");
            assertThat((List<?>) schema.get("oneOf")).hasSize(3);
            Map<String, Object> properties = (Map<String, Object>) schema.get("properties");
            Map<String, Object> file = (Map<String, Object>) properties.get("pdfFile");
            assertThat((List<String>) file.get("required")).containsExactlyInAnyOrder("download_url", "file_id");
            assertThat((Map<String, Object>) file.get("properties")).containsOnlyKeys("download_url", "file_id", "mime_type", "file_name");
        }
        Map<String, Object> common = catalog.stream().filter(item -> "prepare_lesson".equals(item.get("name"))).findFirst().orElseThrow();
        assertThat((Map<String, Object>) common.get("_meta")).containsEntry("openai/fileParams", List.of("workbookFile", "answersFile"));
    }

    @Test
    void attachedPersonalPdfIsResolvedInsideReceiptAndReplayDoesNotFetchAgain() {
        byte[] pdf = "%PDF-1.7\nattached-private-workbook".getBytes(StandardCharsets.UTF_8);
        ChatGptPdfResolver resolver = spy(new ChatGptPdfResolver("files.oaiusercontent.com"));
        controller.setChatGptPdfResolver(resolver);
        ChatGptFileReference first = resolver.reference(file("first-secret"), "pdfFile", "", "personal-workbook.pdf");
        doReturn(new PdfInput("attached.pdf", pdf, "file-one")).when(resolver).resolve(first);
        var saved = new PersonalLessonWorkbookService.PersonalWorkbookResponse(studentId, "Student", true, "attached.pdf", 1L);
        when(personal.upload(teacher, EVENT, studentId, "attached.pdf", pdf)).thenReturn(saved);
        when(access.asTeacher(any(), eq(teacher), any())).thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(2)).get());
        List<Map<String, Object>> fingerprints = new java.util.ArrayList<>();
        when(receipts.execute(any(), eq(owner.getId()), eq("upload_personal_lesson_workbook"), eq("attached-001"), any(), any(), any()))
                .thenAnswer(invocation -> {
                    ((Runnable) invocation.getArgument(5)).run();
                    fingerprints.add(invocation.getArgument(4));
                    return fingerprints.size() == 1 ? ((Supplier<?>) invocation.getArgument(6)).get() : saved;
                });
        Map<String, Object> args = new HashMap<>(target());
        args.put("studentId", studentId.toString()); args.put("idempotencyKey", "attached-001"); args.put("pdfFile", file("first-secret"));
        assertThat(call("admin", "upload_personal_lesson_workbook", args).get("isError")).isEqualTo(false);
        args.put("pdfFile", file("expired-or-renewed-secret"));
        Map<String, Object> replay = call("admin", "upload_personal_lesson_workbook", args);
        assertThat(replay.get("structuredContent")).isEqualTo(saved);
        assertThat(fingerprints).hasSize(2);
        assertThat(fingerprints.get(0)).isEqualTo(fingerprints.get(1));
        assertThat(json.writeValueAsString(fingerprints)).doesNotContain("secret", "download_url", "https:", "pdfBase64");
        verify(resolver).resolve(first);
        verify(personal).upload(teacher, EVENT, studentId, "attached.pdf", pdf);
        verifyNoInteractions(drive, shared);
    }

    @Test
    void attachedPdfCannotBypassSourceExclusivityOrCurrentStudentAuthorization() {
        ChatGptPdfResolver resolver = mock(ChatGptPdfResolver.class);
        controller.setChatGptPdfResolver(resolver);
        Map<String, Object> args = upload("%PDF-1.7\nlegacy".getBytes(StandardCharsets.UTF_8));
        args.put("pdfFile", file("secret"));
        assertRejected(call("owner", "upload_personal_lesson_workbook", args), 400);
        args.remove("pdfBase64"); args.put("studentId", UUID.randomUUID().toString());
        assertRejected(call("owner", "upload_personal_lesson_answers", args), 404);
        verifyNoInteractions(resolver, receipts, drive, personalAnswers, shared);
        verify(personal, never()).upload(any(), any(), any(), any(), any());
    }

    private Map<String, Object> file(String signature) {
        return Map.of("download_url", "https://files.oaiusercontent.com/document.pdf?sig=" + signature,
                "file_id", "file-one", "mime_type", "application/pdf", "file_name", "attached.pdf");
    }

    @Test
    @SuppressWarnings("unchecked")
    void discoveryAndInitializationExplainTwoBoardsAndTheCommonOrBlankFallback() {
        for (String method : List.of("initialize", "server/discover")) {
            Map<String, Object> discovery = request("owner", method, Map.of());
            assertThat((Map<String, Object>) discovery.get("serverInfo")).containsEntry("version", "1.29.0");
            assertThat(String.valueOf(discovery.get("instructions"))).contains("Shared board and My board (Моя доска)",
                    "takes priority over the common workbook", "uses the common workbook or stays blank",
                    "Shared board continues to show the common workbook to everyone");
            assertThat(String.valueOf(discovery.get("instructions"))).doesNotContain("separate Personal worksheet tab");
        }
    }

    @Test
    void forgedInvocationCannotBypassActorOrTargetPilotChecks() {
        assertRejected(call("other", "list_personal_lesson_workbooks", target()), 403);
        assertRejected(call("import-key", "list_personal_lesson_workbooks", target()), 403);
        Map<String, Object> foreignTeacher = new HashMap<>(target());
        foreignTeacher.put("teacherId", otherTeacher.getId().toString());
        assertRejected(call("admin", "list_personal_lesson_workbooks", foreignTeacher), 403);
        assertRejected(call("other", "upload_personal_lesson_answers", target()), 403);
        assertRejected(call("import-key", "upload_personal_lesson_answers", target()), 403);
        assertRejected(call("admin", "upload_personal_lesson_answers", foreignTeacher), 403);
        verifyNoInteractions(personal, personalAnswers, receipts);
    }

    @Test
    void listsOnlyCurrentPersonalWorksheetMetadataAndDoesNotReadSharedPreparation() {
        Map<String, Object> result = call("admin", "list_personal_lesson_workbooks", target());
        assertThat(result.get("isError")).isEqualTo(false);
        assertThat(json.writeValueAsString(result.get("structuredContent"))).contains("Student", studentId.toString());
        verify(personal).list(teacher, EVENT);
        verifyNoInteractions(shared, drive, receipts);
    }

    @Test
    void uploadUsesDurableReceiptAndRevalidatesExactStudentWithoutReplacingSharedWorkbook() {
        byte[] pdf = "%PDF-1.7\nworksheet".getBytes(StandardCharsets.UTF_8);
        var saved = new PersonalLessonWorkbookService.PersonalWorkbookResponse(studentId, "Student", true, "student.pdf", 1L);
        when(personal.upload(teacher, EVENT, studentId, "student.pdf", pdf)).thenReturn(saved);
        when(access.asTeacher(any(), eq(teacher), any())).thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(2)).get());
        when(receipts.execute(any(), eq(owner.getId()), eq("upload_personal_lesson_workbook"), eq("requested-upload-001"), any(), any(), any()))
                .thenAnswer(invocation -> {
                    ((Runnable) invocation.getArgument(5)).run();
                    return ((Supplier<?>) invocation.getArgument(6)).get();
                });
        Map<String, Object> args = upload(pdf);
        Map<String, Object> result = call("admin", "upload_personal_lesson_workbook", args);
        assertThat(result.get("isError")).isEqualTo(false);
        assertThat(result.get("structuredContent")).isEqualTo(saved);
        verify(receipts).execute(eq(principal(admin)), eq(owner.getId()), eq("upload_personal_lesson_workbook"),
                eq("requested-upload-001"), any(), any(), any());
        verify(personal).upload(teacher, EVENT, studentId, "student.pdf", pdf);
        verifyNoInteractions(shared, drive);
    }

    @Test
    void rejectsUnknownStudentAndAmbiguousPdfSourcesBeforeAnyUpload() {
        byte[] pdf = "%PDF-1.7\nworksheet".getBytes(StandardCharsets.UTF_8);
        Map<String, Object> args = upload(pdf);
        args.put("studentId", UUID.randomUUID().toString());
        assertThat(call("owner", "upload_personal_lesson_workbook", args).get("isError")).isEqualTo(true);
        args = upload(pdf);
        args.put("driveFileId", "drive-file");
        assertRejected(call("owner", "upload_personal_lesson_workbook", args), 400);
        args = upload(pdf);
        args.remove("idempotencyKey");
        assertRejected(call("owner", "upload_personal_lesson_workbook", args), 400);
        verify(personal, never()).upload(any(), any(), any(), any(), any());
        verifyNoInteractions(receipts, drive, shared);
    }

    @Test
    void listIncludesPrivateAnswerStatusForStaffWithoutAnswerBytes() {
        when(personal.list(teacher, EVENT)).thenReturn(new PersonalLessonWorkbookService.PersonalWorkbooksResponse(
                true, List.of(new PersonalLessonWorkbookService.PersonalWorkbookResponse(
                        studentId, "Student", true, "student.pdf", 1L, true, "private-answers.pdf", 2L))));
        Map<String, Object> result = call("owner", "list_personal_lesson_workbooks", target());
        assertThat(result.get("isError")).isEqualTo(false);
        String metadata = json.writeValueAsString(result.get("structuredContent"));
        assertThat(metadata).contains("\"hasAnswers\":true", "private-answers.pdf", "\"answersVersion\":2");
        assertThat(metadata).doesNotContain("base64", "pdfBase64", "workbookPdf", "answersPdf");
        verifyNoInteractions(personalAnswers, shared, drive, receipts);
    }

    @Test
    void directPersonalAnswersUploadUsesItsOwnReceiptAndPreservesAllWorkbooksAndSharedAnswers() {
        byte[] pdf = "%PDF-1.7\nprivate-answer-key".getBytes(StandardCharsets.UTF_8);
        var saved = new PersonalLessonAnswersService.Metadata(studentId, true, "private-answers.pdf", 1L);
        when(personalAnswers.upload(teacher, EVENT, studentId, "private-answers.pdf", pdf)).thenReturn(saved);
        stubReceipt("upload_personal_lesson_answers", "requested-answers-001");
        Map<String, Object> args = answersUpload(pdf);
        Map<String, Object> result = call("admin", "upload_personal_lesson_answers", args);
        assertThat(result.get("isError")).isEqualTo(false);
        assertThat(result.get("structuredContent")).isEqualTo(saved);
        assertThat(json.writeValueAsString(result)).doesNotContain("private-answer-key", "pdfBase64", "base64");
        verify(receipts).execute(eq(principal(admin)), eq(owner.getId()), eq("upload_personal_lesson_answers"),
                eq("requested-answers-001"), any(), any(), any());
        verify(personalAnswers).upload(teacher, EVENT, studentId, "private-answers.pdf", pdf);
        verify(personal, never()).upload(any(), any(), any(), any(), any());
        verifyNoInteractions(shared, drive);
    }

    @Test
    void drivePersonalAnswersUseTheSelectedTeachersAccessAndReturnOnlyMetadata() {
        byte[] pdf = "%PDF-1.7\nprivate-drive-answer-key".getBytes(StandardCharsets.UTF_8);
        var saved = new PersonalLessonAnswersService.Metadata(studentId, true, "private-answers.pdf", 1L);
        when(drive.downloadForTeacher(owner.getId(), "drive-answers-file", "private-answers.pdf")).thenReturn(pdf);
        when(personalAnswers.upload(teacher, EVENT, studentId, "private-answers.pdf", pdf)).thenReturn(saved);
        stubReceipt("upload_personal_lesson_answers", "requested-answers-001");
        Map<String, Object> args = answersUpload(pdf);
        args.remove("pdfBase64"); args.put("driveFileId", "drive-answers-file");
        Map<String, Object> result = call("owner", "upload_personal_lesson_answers", args);
        assertThat(result.get("isError")).isEqualTo(false);
        assertThat(result.get("structuredContent")).isEqualTo(saved);
        verify(drive).downloadForTeacher(owner.getId(), "drive-answers-file", "private-answers.pdf");
        verify(personal, never()).upload(any(), any(), any(), any(), any());
        verifyNoInteractions(shared);
    }

    @Test
    void personalAnswerReceiptRechecksTheCurrentLessonRosterBeforeWriting() {
        byte[] pdf = "%PDF-1.7\nprivate-answer-key".getBytes(StandardCharsets.UTF_8);
        var initial = new PersonalLessonWorkbookService.PersonalWorkbooksResponse(true,
                List.of(new PersonalLessonWorkbookService.PersonalWorkbookResponse(studentId, "Student", false, null, 0L)));
        when(personal.list(teacher, EVENT)).thenReturn(initial,
                new PersonalLessonWorkbookService.PersonalWorkbooksResponse(true, List.of()));
        stubReceipt("upload_personal_lesson_answers", "requested-answers-001");
        assertRejected(call("owner", "upload_personal_lesson_answers", answersUpload(pdf)), 404);
        verifyNoInteractions(personalAnswers, shared, drive);
        verify(personal, never()).upload(any(), any(), any(), any(), any());
    }

    @Test
    void personalAnswersRejectUnknownRecipientsAmbiguousSourcesAndMissingRetryKey() {
        byte[] pdf = "%PDF-1.7\nprivate-answer-key".getBytes(StandardCharsets.UTF_8);
        Map<String, Object> args = answersUpload(pdf);
        args.put("studentId", UUID.randomUUID().toString());
        assertRejected(call("owner", "upload_personal_lesson_answers", args), 404);
        args = answersUpload(pdf); args.put("driveFileId", "drive-file");
        assertRejected(call("owner", "upload_personal_lesson_answers", args), 400);
        args = answersUpload(pdf); args.remove("idempotencyKey");
        assertRejected(call("owner", "upload_personal_lesson_answers", args), 400);
        verifyNoInteractions(personalAnswers, shared, drive, receipts);
        verify(personal, never()).upload(any(), any(), any(), any(), any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void studentCannotInvokePrivateAnswerToolsEvenByName() {
        Map<String, Object> envelope = (Map<String, Object>) controller.post("Bearer student", null,
                Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/call", "params", Map.of(
                        "name", "upload_personal_lesson_answers", "arguments", target()))).getBody();
        assertThat(envelope).containsKey("error");
        verifyNoInteractions(personalAnswers, personal, receipts, shared, drive);
    }

    private void stubReceipt(String operation, String key) {
        when(access.asTeacher(any(), eq(teacher), any())).thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(2)).get());
        when(receipts.execute(any(), eq(owner.getId()), eq(operation), eq(key), any(), any(), any()))
                .thenAnswer(invocation -> {
                    ((Runnable) invocation.getArgument(5)).run();
                    return ((Supplier<?>) invocation.getArgument(6)).get();
                });
    }

    private Map<String, Object> answersUpload(byte[] pdf) {
        Map<String, Object> args = upload(pdf);
        args.put("filename", "private-answers.pdf");
        args.put("idempotencyKey", "requested-answers-001");
        return args;
    }

    private Map<String, Object> upload(byte[] pdf) {
        Map<String, Object> args = new HashMap<>(target());
        args.put("studentId", studentId.toString());
        args.put("filename", "student.pdf");
        args.put("pdfBase64", Base64.getEncoder().encodeToString(pdf));
        args.put("idempotencyKey", "requested-upload-001");
        return args;
    }

    private Map<String, Object> target() {
        return Map.of("teacherId", owner.getId().toString(), "eventId", EVENT);
    }

    @SuppressWarnings("unchecked")
    private List<String> toolNames(String token) {
        Map<String, Object> response = request(token, "tools/list", Map.of());
        return ((List<Map<String, Object>>) response.get("tools")).stream().map(tool -> String.valueOf(tool.get("name"))).toList();
    }

    private Map<String, Object> call(String token, String tool, Map<String, Object> args) {
        return request(token, "tools/call", Map.of("name", tool, "arguments", args));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> request(String token, String method, Map<String, Object> params) {
        Object raw = controller.post("Bearer " + token, null,
                Map.of("jsonrpc", "2.0", "id", 1, "method", method, "params", params)).getBody();
        Map<String, Object> envelope = (Map<String, Object>) raw;
        assertThat(envelope).doesNotContainKey("error");
        return (Map<String, Object>) envelope.get("result");
    }

    @SuppressWarnings("unchecked")
    private void assertRejected(Map<String, Object> result, int status) {
        assertThat(result.get("isError")).isEqualTo(true);
        assertThat(((Map<String, Object>) result.get("structuredContent")).get("status")).isEqualTo(status);
    }

    private AuthenticatedUser principal(User user) {
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole());
    }
}
