package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.drive.TeacherGoogleDriveDownloadService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanService;
import com.mcschool.flashcard.settings.*;
import com.mcschool.flashcard.trialleads.FunnelAnalyticsService;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

/** Controller boundaries: authorize first, preserve stable receipts, then import both PDF slots. */
class McpDirectPdfToolsTest {
    private static final String EVENT = "actual-lesson-event";
    private final ObjectMapper json = new ObjectMapper();
    private final UserRepository users = mock(UserRepository.class);
    private final McpOAuthService oauth = mock(McpOAuthService.class);
    private final GoogleCalendarLessonService calendar = mock(GoogleCalendarLessonService.class);
    private final LessonPreparationService preparations = mock(LessonPreparationService.class);
    private final TeacherGoogleDriveDownloadService drive = mock(TeacherGoogleDriveDownloadService.class);
    private final McpAccessService access = mock(McpAccessService.class);
    private final McpOperationReceiptService receipts = mock(McpOperationReceiptService.class);
    private final ChatGptPdfResolver files = spy(new ChatGptPdfResolver("files.oaiusercontent.com"));
    private final byte[] workbook = "%PDF-1.7\nshared-workbook".getBytes(StandardCharsets.UTF_8);
    private final byte[] answers = "%PDF-1.7\nshared-answers".getBytes(StandardCharsets.UTF_8);
    private MindcraftiMcpController controller;
    private User teacherUser, admin, foreignTeacher;
    private AuthenticatedUser teacher;
    private LessonPreparationResponse saved;

    @BeforeEach void setUp() {
        teacherUser = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "unused");
        ReflectionTestUtils.setField(teacherUser, "id", UUID.randomUUID());
        admin = User.bootstrapAdmin("Admin", "admin@test.local", "unused");
        foreignTeacher = User.activeTeacher("Other", "other@test.local", "other", "unused");
        teacher = principal(teacherUser);
        when(oauth.resolveAccessToken("teacher")).thenReturn(Optional.of(teacherUser));
        when(oauth.resolveAccessToken("admin")).thenReturn(Optional.of(admin));
        when(oauth.resolveAccessToken("foreign")).thenReturn(Optional.of(foreignTeacher));
        when(users.findById(teacherUser.getId())).thenReturn(Optional.of(teacherUser));
        when(access.requireActor(teacherUser)).thenReturn(teacher);
        when(access.requireActor(admin)).thenReturn(principal(admin));
        when(access.requireTeacher(any(), eq(teacher.id()))).thenReturn(teacher);
        when(access.asTeacher(any(), eq(teacher), any())).thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(2)).get());
        when(calendar.listGroupLessons(teacher)).thenReturn(List.of(new GroupLessonResponse(EVENT, "binding", null,
                null, UUID.randomUUID(), "Student", List.of(), "Lesson", Instant.parse("2026-11-05T14:00:00Z"),
                Instant.parse("2026-11-05T15:00:00Z"), null, null)));
        saved = new LessonPreparationResponse(EVENT, "old notes", "old difficulties", "old plan", null,
                false, null, true, "workbook.pdf", true, "answers.pdf", null, null, null, null, null);
        when(preparations.prepareMaterials(any(), any(), any(), any(), any(), any(), any())).thenReturn(saved);
        controller = new MindcraftiMcpController("import-key", json, users, oauth, calendar, preparations,
                mock(LessonPreparationRepository.class), mock(TranscriptLessonGuard.class), drive,
                mock(McpHomeworkSeriesService.class), mock(McpAnalyticsService.class), mock(McpHomeworkReadService.class),
                mock(McpHomeworkWriteService.class), mock(MonthlyPlanService.class), mock(SchoolPromptSettingsService.class),
                mock(SchoolBrandGuideService.class), mock(LessonPdfDraftService.class), mock(StoryTemplateMasterService.class),
                mock(StoryTemplateDownloadLinkService.class), mock(FunnelAnalyticsService.class));
        controller.setChatGptPdfResolver(files);
        controller.setPersonalWorkbookAccess(access);
        controller.setPersonalWorkbookReceipts(receipts);
    }

    @Test void attachedPairUsesOneAtomicWriteAndStableReceiptWithoutDownloadUrls() {
        Map<String, Object> args = attachedPair("first-secret");
        ChatGptFileReference bookRef = files.reference(args.get("workbookFile"), "workbookFile", "", "lesson-workbook.pdf");
        ChatGptFileReference answersRef = files.reference(args.get("answersFile"), "answersFile", "", "lesson-answers.pdf");
        doReturn(new PdfInput("workbook.pdf", workbook, "file-workbook")).when(files).resolve(bookRef);
        doReturn(new PdfInput("answers.pdf", answers, "file-answers")).when(files).resolve(answersRef);
        List<Map<String, Object>> identities = new ArrayList<>();
        when(receipts.execute(any(), eq(teacher.id()), eq("prepare_lesson"), eq("prepare-001"), any(), any(), any()))
                .thenAnswer(invocation -> {
                    ((Runnable) invocation.getArgument(5)).run();
                    identities.add(invocation.getArgument(4));
                    return identities.size() == 1 ? ((Supplier<?>) invocation.getArgument(6)).get() : saved;
                });
        Map<String, Object> result = call("admin", args);
        assertThat(result.get("structuredContent")).isEqualTo(saved);
        assertThat(result.get("isError")).isEqualTo(false);
        Map<String, Object> replay = call("admin", attachedPair("renewed-or-expired-secret"));
        assertThat(replay.get("structuredContent")).isEqualTo(saved);
        assertThat(identities).hasSize(2);
        assertThat(identities.get(0)).isEqualTo(identities.get(1));
        assertThat(json.writeValueAsString(identities)).doesNotContain("download_url", "secret", "https:");
        verify(files).resolve(bookRef); verify(files).resolve(answersRef);
        ArgumentCaptor<UpdateLessonPreparationRequest> notes = ArgumentCaptor.forClass(UpdateLessonPreparationRequest.class);
        verify(preparations).prepareMaterials(eq(teacher), eq(EVENT), notes.capture(), eq("workbook.pdf"), eq(workbook), eq("answers.pdf"), eq(answers));
        assertThat(notes.getValue().homeworkNotes()).isNull();
        assertThat(notes.getValue().difficulties()).isNull();
        assertThat(notes.getValue().lessonPlan()).isNull();
        verifyNoInteractions(drive);
        verify(preparations, never()).getOrCreate(any(), any());
        verify(preparations, never()).update(any(), any(), any());
        assertThat(json.writeValueAsString(result)).contains("workbook.pdf", "answers.pdf")
                .doesNotContain("shared-workbook", "shared-answers", "base64", "download_url");
    }

    @Test
    @SuppressWarnings("unchecked")
    void advertisedPairInputKeepsOfficialFilesWithoutCrossFieldSchemaAlternatives() {
        Map<String, Object> envelope = (Map<String, Object>) controller.post("Bearer admin", null,
                Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/list")).getBody();
        List<Map<String, Object>> tools = (List<Map<String, Object>>) ((Map<String, Object>) envelope.get("result")).get("tools");
        Map<String, Object> tool = tools.stream().filter(item -> "prepare_lesson".equals(item.get("name")))
                .findFirst().orElseThrow();
        assertThat((Map<String, Object>) tool.get("_meta"))
                .containsEntry("openai/fileParams", List.of("workbookFile", "answersFile"));
        Map<String, Object> schema = (Map<String, Object>) tool.get("inputSchema");
        assertThat(schema).containsEntry("type", "object").containsEntry("additionalProperties", false)
                .doesNotContainKeys("oneOf", "anyOf", "allOf", "not");
        assertThat((List<String>) schema.get("required")).containsExactlyInAnyOrder("teacherId", "eventId");
        Map<String, Object> properties = (Map<String, Object>) schema.get("properties");
        for (String field : List.of("workbookFile", "answersFile")) {
            Map<String, Object> file = (Map<String, Object>) properties.get(field);
            assertThat(file).containsEntry("type", "object").containsEntry("additionalProperties", false);
            assertThat((List<String>) file.get("required")).containsExactlyInAnyOrder("download_url", "file_id");
            assertThat((Map<String, Object>) file.get("properties"))
                    .containsOnlyKeys("download_url", "file_id", "mime_type", "file_name");
        }
        assertThat(properties).containsKeys("idempotencyKey", "workbookBase64", "answersBase64",
                "driveWorkbookFileId", "driveAnswersFileId");
    }

    @Test void attachedPairAcceptsBlankOptionalLegacySourcesWithoutTreatingThemAsExtraFiles() {
        Map<String, Object> args = attachedPair("secret");
        for (String field : List.of("workbookBase64", "answersBase64", "driveWorkbookFileId", "driveAnswersFileId")) {
            args.put(field, "");
        }
        ChatGptFileReference bookRef = files.reference(args.get("workbookFile"), "workbookFile", "", "lesson-workbook.pdf");
        ChatGptFileReference answersRef = files.reference(args.get("answersFile"), "answersFile", "", "lesson-answers.pdf");
        doReturn(new PdfInput("workbook.pdf", workbook, "file-workbook")).when(files).resolve(bookRef);
        doReturn(new PdfInput("answers.pdf", answers, "file-answers")).when(files).resolve(answersRef);
        executeReceipt();

        assertThat(call("admin", args).get("isError")).isEqualTo(false);

        verify(preparations).prepareMaterials(eq(teacher), eq(EVENT), any(), eq("workbook.pdf"),
                eq(workbook), eq("answers.pdf"), eq(answers));
        verify(files).resolve(bookRef);
        verify(files).resolve(answersRef);
        verifyNoInteractions(drive);
    }

    @Test void secondFileFailureLeavesNotesAndBothDocumentsUntouched() {
        Map<String, Object> args = attachedPair("secret");
        args.put("lessonPlan", "new plan that must not be partially written");
        ChatGptFileReference bookRef = files.reference(args.get("workbookFile"), "workbookFile", "", "lesson-workbook.pdf");
        ChatGptFileReference answersRef = files.reference(args.get("answersFile"), "answersFile", "", "lesson-answers.pdf");
        doReturn(new PdfInput("workbook.pdf", workbook, "file-workbook")).when(files).resolve(bookRef);
        doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,
                "Attached lesson file is not a readable PDF")).when(files).resolve(answersRef);
        executeReceipt();
        rejected(call("teacher", args), 400);
        verify(files).resolve(bookRef); verify(files).resolve(answersRef);
        verifyNoInteractions(preparations, drive);
    }

    @Test void rejectsAmbiguousSourcesAndMissingKeyBeforeAnyDownloadOrWrite() {
        Map<String, Object> args = attachedPair("secret");
        args.put("workbookBase64", Base64.getEncoder().encodeToString(workbook));
        Map<String, Object> workbookConflict = call("teacher", args);
        rejected(workbookConflict, 400);
        assertThat(json.writeValueAsString(workbookConflict)).contains("exactly_one_source_required");
        args = attachedPair("secret"); args.put("driveAnswersFileId", "nonempty-conflicting-source");
        Map<String, Object> answersConflict = call("teacher", args);
        rejected(answersConflict, 400);
        assertThat(json.writeValueAsString(answersConflict)).contains("exactly_one_source_required");
        args = attachedPair("secret"); args.remove("idempotencyKey");
        rejected(call("teacher", args), 400);
        verify(files, never()).resolve(any());
        verifyNoInteractions(preparations, drive, receipts);
    }

    @Test void validatesExactTeacherAndLessonBeforeResolvingFiles() {
        rejected(call("foreign", attachedPair("secret")), 400);
        Map<String, Object> args = attachedPair("secret"); args.put("eventId", "forged-foreign-event");
        rejected(call("admin", args), 400);
        verify(files, never()).resolve(any());
        verifyNoInteractions(preparations, drive, receipts);
    }

    @Test void freshAuthorizationGuardRunsOnReceiptReplay() {
        when(calendar.listGroupLessons(teacher)).thenReturn(List.of(new GroupLessonResponse(EVENT, "binding", null,
                null, UUID.randomUUID(), "Student", List.of(), "Lesson", Instant.now(), Instant.now().plusSeconds(3600), null, null)), List.of());
        executeReceipt();
        rejected(call("admin", attachedPair("secret")), 400);
        verify(files, never()).resolve(any());
        verifyNoInteractions(preparations, drive);
    }

    @Test void legacyBase64AndDriveRemainUsableWithoutKeyAndEmptyNotesClearOnlySpecifiedField() throws Exception {
        Map<String, Object> args = target();
        args.put("workbookBase64", Base64.getEncoder().encodeToString(workbook));
        args.put("driveAnswersFileId", "teacher-drive-answers");
        args.put("workbookFilename", "book.pdf"); args.put("answersFilename", "answers.pdf");
        args.put("homeworkNotes", "");
        when(drive.downloadForTeacher(teacher.id(), "teacher-drive-answers", "answers.pdf")).thenReturn(answers);
        assertThat(call("teacher", args).get("isError")).isEqualTo(false);
        ArgumentCaptor<UpdateLessonPreparationRequest> notes = ArgumentCaptor.forClass(UpdateLessonPreparationRequest.class);
        verify(preparations).prepareMaterials(eq(teacher), eq(EVENT), notes.capture(), eq("book.pdf"), eq(workbook), eq("answers.pdf"), eq(answers));
        assertThat(notes.getValue().homeworkNotes()).isEmpty();
        assertThat(notes.getValue().lessonPlan()).isNull();
        assertThat(notes.getValue().difficulties()).isNull();
        verify(files, never()).resolve(any());
        verifyNoInteractions(receipts);
    }

    @Test void badLegacySecondPdfNeverCausesFirstPdfOrNotesWrite() {
        Map<String, Object> args = target();
        args.put("workbookBase64", Base64.getEncoder().encodeToString(workbook));
        args.put("answersBase64", "this-is-not-base64");
        args.put("lessonPlan", "plan");
        rejected(call("teacher", args), 400);
        verifyNoInteractions(preparations, receipts, drive);
    }

    @Test void legacyAnswersPrefixCannotCombineWithAnotherAnswerSource() {
        Map<String, Object> args = target();
        args.put("workbookFilename", "__answers__:legacy.pdf");
        args.put("workbookBase64", Base64.getEncoder().encodeToString(answers));
        args.put("answersBase64", Base64.getEncoder().encodeToString(answers));
        rejected(call("teacher", args), 400);
        verifyNoInteractions(preparations, receipts, drive);
    }

    private void executeReceipt() {
        when(receipts.execute(any(), eq(teacher.id()), eq("prepare_lesson"), any(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    ((Runnable) invocation.getArgument(5)).run();
                    return ((Supplier<?>) invocation.getArgument(6)).get();
                });
    }

    private Map<String, Object> attachedPair(String signature) {
        Map<String, Object> args = target(); args.put("idempotencyKey", "prepare-001");
        args.put("workbookFile", file("workbook", signature)); args.put("answersFile", file("answers", signature));
        return args;
    }

    private Map<String, Object> file(String kind, String signature) {
        return Map.of("download_url", "https://files.oaiusercontent.com/" + kind + ".pdf?sig=" + signature,
                "file_id", "file-" + kind, "mime_type", "application/pdf", "file_name", kind + ".pdf");
    }

    private Map<String, Object> target() { return new HashMap<>(Map.of("teacherId", teacher.id().toString(), "eventId", EVENT)); }
    private AuthenticatedUser principal(User user) { return new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole()); }

    @SuppressWarnings("unchecked")
    private Map<String, Object> call(String token, Map<String, Object> arguments) {
        Map<String, Object> envelope = (Map<String, Object>) controller.post("Bearer " + token, null,
                Map.of("jsonrpc", "2.0", "id", 1, "method", "tools/call", "params",
                        Map.of("name", "prepare_lesson", "arguments", arguments))).getBody();
        assertThat(envelope).doesNotContainKey("error");
        return (Map<String, Object>) envelope.get("result");
    }

    @SuppressWarnings("unchecked")
    private void rejected(Map<String, Object> result, int status) {
        assertThat(result.get("isError")).isEqualTo(true);
        assertThat((Map<String, Object>) result.get("structuredContent")).containsEntry("status", status);
    }
}
