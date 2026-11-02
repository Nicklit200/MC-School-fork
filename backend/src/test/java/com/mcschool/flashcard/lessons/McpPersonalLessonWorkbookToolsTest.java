package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

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
        controller.setPersonalWorkbookAccess(access);
        controller.setPersonalWorkbookReceipts(receipts);
    }

    @Test
    void catalogExposesPilotToolsToOwnerAndAdministratorsButNotOtherTeachersOrImportKey() {
        for (String token : List.of("owner", "admin")) {
            assertThat(toolNames(token)).contains("list_personal_lesson_workbooks", "upload_personal_lesson_workbook");
        }
        for (String token : List.of("other", "import-key")) {
            assertThat(toolNames(token)).doesNotContain("list_personal_lesson_workbooks", "upload_personal_lesson_workbook");
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void catalogDescribesSeparatePersonalWorksheetTabAndAnnotationTarget() {
        Map<String, Object> catalog = request("owner", "tools/list", Map.of());
        List<Map<String, Object>> tools = (List<Map<String, Object>>) catalog.get("tools");
        String description = tools.stream().filter(tool -> "upload_personal_lesson_workbook".equals(tool.get("name")))
                .map(tool -> String.valueOf(tool.get("description"))).findFirst().orElseThrow();
        assertThat(description).contains("Персональный лист", "personal-workbook-<studentUserId>", "existing My board remain available");
    }

    @Test
    void forgedInvocationCannotBypassActorOrTargetPilotChecks() {
        assertRejected(call("other", "list_personal_lesson_workbooks", target()), 403);
        assertRejected(call("import-key", "list_personal_lesson_workbooks", target()), 403);
        Map<String, Object> foreignTeacher = new HashMap<>(target());
        foreignTeacher.put("teacherId", otherTeacher.getId().toString());
        assertRejected(call("admin", "list_personal_lesson_workbooks", foreignTeacher), 403);
        verifyNoInteractions(personal, receipts);
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
