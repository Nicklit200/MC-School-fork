package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.CardController;
import com.mcschool.flashcard.cards.dto.ImportPreviewRequest;
import com.mcschool.flashcard.lessonboard.LessonBoardController;
import com.mcschool.flashcard.students.StudentController;
import com.mcschool.flashcard.settings.StoryStudioProjectController;
import com.mcschool.flashcard.settings.StoryStudioProjectService;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.teachers.TeacherController;
import com.mcschool.flashcard.users.Language;
import com.mcschool.flashcard.users.AdminAccountController;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserResponse;
import com.mcschool.flashcard.users.UserStatus;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class McpSiteFunctionsServiceTest {
    private final ApplicationContext context = mock(ApplicationContext.class);
    private final McpAccessService access = mock(McpAccessService.class);
    private final McpOperationReceiptService receipts = mock(McpOperationReceiptService.class);
    private final McpSiteFunctionTargetGuard targets = mock(McpSiteFunctionTargetGuard.class);
    private final StudentController students = mock(StudentController.class);
    private final CardController cards = mock(CardController.class);
    private final LessonBoardController board = mock(LessonBoardController.class);
    private final AdminAccountController accounts = mock(AdminAccountController.class);
    private final LessonTranscriptReadService transcripts = mock(LessonTranscriptReadService.class);
    private final StoryStudioProjectService studio = mock(StoryStudioProjectService.class);
    private final AuthenticatedUser teacher = new AuthenticatedUser(UUID.randomUUID(), "teacher@example.test", Role.TEACHER);
    private final AuthenticatedUser admin = new AuthenticatedUser(UUID.randomUUID(), "admin@example.test", Role.ADMIN);
    private final User oauth = mock(User.class);
    private McpSiteFunctionsService service;

    @BeforeEach
    void setup() {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
        service = new McpSiteFunctionsService(context, JsonMapper.builder().findAndAddModules().build(), validator, access, receipts, targets);
        when(access.requireActor(oauth)).thenReturn(teacher);
        when(access.requireTeacher(eq(teacher), nullable(UUID.class))).thenReturn(teacher);
        when(access.requireTeacher(eq(admin), eq(teacher.id()))).thenReturn(teacher);
        when(access.asTeacher(any(), any(), any())).thenAnswer(invocation -> invocation.getArgument(2, Supplier.class).get());
        when(access.asActor(any(), any())).thenAnswer(invocation -> invocation.getArgument(1, Supplier.class).get());
        when(receipts.execute(any(), nullable(UUID.class), anyString(), anyString(), anyMap(), any(), any()))
                .thenAnswer(invocation -> {
                    invocation.getArgument(5, Runnable.class).run();
                    return invocation.getArgument(6, Supplier.class).get();
                });
        when(receipts.executeExternal(any(), nullable(UUID.class), anyString(), anyString(), anyMap(), any(), any()))
                .thenAnswer(invocation -> {
                    invocation.getArgument(5, Runnable.class).run();
                    return invocation.getArgument(6, Supplier.class).get();
                });
        when(context.getBean(StudentController.class)).thenReturn(students);
        when(context.getBean(CardController.class)).thenReturn(cards);
        when(context.getBean(LessonBoardController.class)).thenReturn(board);
        when(context.getBean(AdminAccountController.class)).thenReturn(accounts);
        when(context.getBean(LessonTranscriptController.class)).thenReturn(new LessonTranscriptController(transcripts));
        when(context.getBean(StoryStudioProjectController.class)).thenReturn(new StoryStudioProjectController(studio));
    }

    @Test
    void registryIsFiniteAndExcludesCredentialsSystemAndStudentActions() {
        List<McpSiteFunctionRegistry.Function> functions = McpSiteFunctionRegistry.functions();
        assertThat(functions).hasSizeGreaterThan(120);
        assertThat(functions.stream().map(McpSiteFunctionRegistry.Function::id)).doesNotHaveDuplicates()
                .contains("students.createStudent", "groups.create", "online_classes.start", "notebook_camera.revoke")
                .doesNotContain("notebook_camera.create", "notebook_camera.connection", "online_classes.connect", "lessons.createLesson");
        assertThat(functions).noneMatch(function -> function.controller().getSimpleName().matches(".*(Auth|Public|Webhook|Study|Integration|Push).*"));
        assertThat(functions).noneMatch(function -> function.method().getName().toLowerCase().contains("password")
                || function.method().getName().toLowerCase().contains("impersonate") || function.method().getName().equals("calendarConnection"));
        assertThat(functions).noneMatch(function -> function.readOnly() && function.externalEffect());
        assertThat(McpSiteFunctionsService.definitions().stream().filter(tool -> tool.get("name").equals("execute_site_function")).findFirst().orElseThrow().get("annotations").toString()).contains("idempotentHint=false");
    }

    @Test
    void teacherCatalogFiltersAdministrativeFunctionsAndReturnsDiscoverableSchema() {
        Map<?, ?> catalog = (Map<?, ?>) service.call("list_site_functions", Map.of("domain", "teachers"), oauth, false);
        assertThat(catalog.get("total")).isEqualTo(0);
        Map<?, ?> metadata = (Map<?, ?>) service.call("get_site_function", Map.of("functionId", "students.createStudent"), oauth, false);
        assertThat(metadata.get("readOnly")).isEqualTo(false);
        assertThat(metadata.get("adminRequiresTeacherId")).isEqualTo(true);
        Map<?, ?> arguments = (Map<?, ?>) metadata.get("argumentsSchema");
        assertThat(arguments.get("additionalProperties")).isEqualTo(false);
        assertThat(arguments.get("required").toString()).contains("body");
        assertThat(metadata.toString()).contains("fullName", "maxLength=100");
        assertThatThrownBy(() -> read("teachers.listTeachers", Map.of())).hasMessageContaining("404");
        assertThatThrownBy(() -> service.call("get_site_function", Map.of("functionId", "drive.download"), oauth, false)).hasMessageContaining("404");
    }

    @Test
    void adminTeacherScopeRequiresExplicitVerifiedSelection() {
        when(access.requireActor(oauth)).thenReturn(admin);
        when(access.requireTeacher(admin, null)).thenThrow(new org.springframework.security.access.AccessDeniedException("Choose teacher"));
        assertThatThrownBy(() -> read("students.listStudents", Map.of())).isInstanceOf(org.springframework.security.access.AccessDeniedException.class).hasMessage("Access denied");
        service.call("read_site_function", Map.of("functionId", "students.listStudents", "teacherId", teacher.id().toString(), "arguments", Map.of()), oauth, false);
        verify(students).listStudents(teacher);
        verify(access).asTeacher(eq(admin), eq(teacher), any());
    }

    @Test
    void savedTranscriptReadIsDiscoverableWithTypedBoundedDefaultsAndNoWriteReceipt() {
        Map<?, ?> metadata = (Map<?, ?>) service.call("get_site_function", Map.of("functionId", "lesson_transcripts.get"), oauth, false);
        assertThat(metadata.get("readOnly")).isEqualTo(true);
        assertThat(metadata.toString()).contains("automatic", "manual", "pdf", "maximum=20000", "default=12000", "expectedRevision", "untrusted data");
        when(transcripts.get(teacher, "saved-event", LessonTranscriptReadService.Source.automatic, 0, 12000, null))
                .thenReturn(new LessonTranscriptReadService.Transcript("saved-event", null, null, null,
                        new LessonTranscriptReadService.Page(LessonTranscriptReadService.Source.automatic, true, "available", "a".repeat(64), 4, 0, 12000, null, false, "text"), "untrusted_lesson_content"));
        assertThat(read("lesson_transcripts.get", Map.of("eventId", "saved-event")).toString()).contains("text", "untrusted_lesson_content");
        verify(transcripts).get(teacher, "saved-event", LessonTranscriptReadService.Source.automatic, 0, 12000, null);
        verify(targets).check(argThat(function -> function.id().equals("lesson_transcripts.get")), eq(teacher), eq(Map.of("eventId", "saved-event")));
        verifyNoInteractions(receipts);
        assertThatThrownBy(() -> read("lesson_transcripts.get", Map.of("eventId", "saved-event", "source", "all"))).hasMessageContaining("400");
        assertThatThrownBy(() -> read("lesson_transcripts.get", Map.of("eventId", "saved-event", "limit", 20001))).hasMessageContaining("400");
    }

    @Test
    void privateStudioSaveHasOnlyItsReviewedLargeFieldBudgetAndUsesAtomicAdminReceipt() {
        assertThatThrownBy(() -> service.call("get_site_function", Map.of("functionId", "stories_studio.save"), oauth, false)).hasMessageContaining("404");
        when(access.requireActor(oauth)).thenReturn(admin);
        Map<?, ?> schema = (Map<?, ?>) service.call("get_site_function", Map.of("functionId", "stories_studio.save"), oauth, false);
        assertThat(schema.get("readOnly")).isEqualTo(false);
        assertThat(schema.toString()).contains("maxLength=1900000", "expectedVersion", "does not publish");
        String project = "x".repeat(MAX_STUDIO_TEST_SIZE);
        when(studio.save(admin, 3, project)).thenReturn(Map.of("version", 4L, "configured", true));
        assertThat(write("stories_studio.save", Map.of("body", Map.of("expectedVersion", 3, "projectJson", project))).toString()).contains("version=4");
        verify(studio).save(admin, 3, project);
        verify(receipts).execute(eq(admin), isNull(), anyString(), anyString(), anyMap(), any(), any());
        verify(receipts, never()).executeExternal(any(), any(), any(), any(), any(), any(), any());
        assertThatThrownBy(() -> read("stories_studio.info", Map.of("projectJson", project))).hasMessageContaining("400");
        assertThatThrownBy(() -> write("stories_studio.save", Map.of("body", Map.of("expectedVersion", 3,
                "projectJson", "x".repeat(StoryStudioProjectService.MAX_CHARS + 1))))).hasMessageContaining("400");
    }

    private static final int MAX_STUDIO_TEST_SIZE = 210_000;

    @Test
    void onlyReadToolCanReadAndMutationToolRequiresConfirmationAndDurableKey() {
        assertThatThrownBy(() -> read("students.createStudent", Map.of("body", Map.of("fullName", "Pupil")))).hasMessageContaining("400");
        assertThatThrownBy(() -> service.call("execute_site_function", Map.of("functionId", "students.createStudent", "arguments", Map.of("body", Map.of("fullName", "Pupil")), "idempotencyKey", "unique-key"), oauth, false)).hasMessageContaining("400");
        assertThatThrownBy(() -> service.call("execute_site_function", Map.of("functionId", "students.createStudent", "arguments", Map.of("body", Map.of("fullName", "Pupil")), "confirm", true, "idempotencyKey", "short"), oauth, false)).hasMessageContaining("400");
        verify(students, never()).createStudent(any(), any());
        verifyNoInteractions(receipts);
    }

    @Test
    void writesUseTrustedPrincipalAndRedactNestedInvitationCredentialsBeforeReceipt() {
        UserResponse profile = new UserResponse(UUID.randomUUID(), "Pupil", null, "pupil1", Role.STUDENT, UserStatus.ACTIVE, Language.RU, null);
        when(students.createStudent(eq(teacher), any())).thenReturn(new StudentInvitationResponse(profile, "never-return-this-secret", Instant.now()));
        Object response = write("students.createStudent", Map.of("body", Map.of("fullName", "Pupil")));
        assertThat(response.toString()).contains("Pupil", "pupil1").doesNotContain("never-return", "invitationToken", "invitationExpiresAt");
        verify(receipts).executeExternal(eq(teacher), eq(teacher.id()), eq("site_students_create_student"), eq("one-action-unique-key"), anyMap(), any(), any());
        verify(targets, times(2)).check(any(), eq(teacher), anyMap());
        Object nested = McpSiteFunctionsService.redact(Map.of("list", List.of(Map.of("temporaryPassword", "secret", "downloadUrl", "secret", "activationUrl", "secret", "profile", Map.of("invitation_token", "secret", "username", "safe")))));
        assertThat(nested.toString()).contains("username=safe").doesNotContain("secret");
    }

    @Test
    void privateAiPilotUsesOriginalActorAndCannotDelegateIntoOwnersPrivilege() {
        when(access.requireActor(oauth)).thenReturn(admin);
        Map<?, ?> metadata = (Map<?, ?>) service.call("get_site_function", Map.of("functionId", "ai_pilot.settings"), oauth, false);
        assertThat(metadata.get("scope")).isEqualTo("CALLER");
        assertThatThrownBy(() -> service.call("read_site_function", Map.of("functionId", "ai_pilot.settings", "teacherId", teacher.id().toString(), "arguments", Map.of()), oauth, false))
                .hasMessageContaining("400");
        verify(access, never()).asTeacher(any(), any(), any());
    }

    @Test
    void administrativeStudentTransferRechecksActiveDestinationBeforeReceiptReplay() {
        when(access.requireActor(oauth)).thenReturn(admin);
        when(access.requireTeacher(admin, teacher.id())).thenReturn(teacher)
                .thenThrow(new org.springframework.security.access.AccessDeniedException("Destination was archived"));
        assertThatThrownBy(() -> write("admin_accounts.assignStudentTeacher", Map.of("studentId", UUID.randomUUID().toString(), "body", Map.of("teacherId", teacher.id().toString()))))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class).hasMessage("Access denied");
        verify(access, times(2)).requireTeacher(admin, teacher.id());
        verify(accounts, never()).assignStudentTeacher(any(), any());
    }

    @Test
    void rejectsUnknownFieldsWrongScalarTypesAndInvalidDtosBeforeInvocation() {
        assertThatThrownBy(() -> write("students.createStudent", Map.of("body", Map.of("fullName", "Pupil", "role", "ADMIN")))).hasMessageContaining("400");
        assertThatThrownBy(() -> write("students.createStudent", Map.of("body", Map.of("fullName", " ")))).hasMessageContaining("400");
        assertThatThrownBy(() -> write("students.createStudent", Map.of("body", Map.of("fullName", "x".repeat(101))))).hasMessageContaining("400");
        assertThatThrownBy(() -> write("students.createStudent", Map.of("body", Map.of("fullName", 123)))).hasMessageContaining("400");
        assertThatThrownBy(() -> read("students.listStudents", Map.of("caller", Map.of("id", admin.id().toString())))).hasMessageContaining("400");
        assertThatThrownBy(() -> write("students.createStudent", Map.of("body", Map.of("fullName", "Pupil", "password", "secret")))).hasMessageContaining("400");
        verify(students, never()).createStudent(any(), any());
    }

    @Test
    void requestDtoWhitespaceSeparatorsKeepMvcValidationSemantics() {
        read("cards.previewImport", Map.of("body", Map.of("rawText", "one\ttwo", "cardSeparator", "\n", "questionAnswerSeparator", "\t")));
        verify(cards).previewImport(new ImportPreviewRequest("one\ttwo", "\t", "\n"));
    }

    @Test
    void mvcQueryDefaultsAreBoundAndOwnershipPreflightRuns() {
        when(board.read(teacher, "event-1", 0L)).thenReturn(new LessonBoardController.BoardSnapshot("Lesson", "event-1", true, null, List.of()));
        read("lesson_board.read", Map.of("eventId", "event-1"));
        verify(board).read(teacher, "event-1", 0L);
        verify(targets).check(argThat(function -> function.id().equals("lesson_board.read")), eq(teacher), eq(Map.of("eventId", "event-1")));
        assertThatThrownBy(() -> read("lesson_board.read", Map.of("eventId", "event-1", "after", "0"))).hasMessageContaining("400");
    }

    @Test
    void multipartRejectsPathTraversalWrongBytesAndFileMetadata() {
        UUID homework = UUID.randomUUID();
        Map<String, Object> pdf = Map.of("filename", "../paper.pdf", "contentType", "application/pdf", "base64", "JVBERi0xLjQ=");
        assertThatThrownBy(() -> write("homework.uploadWorksheet", Map.of("homeworkId", homework.toString(), "file", pdf))).hasMessageContaining("400");
        Map<String, Object> fake = Map.of("filename", "paper.pdf", "contentType", "application/pdf", "base64", "aGVsbG8=");
        assertThatThrownBy(() -> write("homework.uploadWorksheet", Map.of("homeworkId", homework.toString(), "file", fake))).hasMessageContaining("400");
        Map<String, Object> remote = Map.of("filename", "paper.pdf", "contentType", "application/pdf", "url", "https://example.test/secret");
        assertThatThrownBy(() -> write("homework.uploadWorksheet", Map.of("homeworkId", homework.toString(), "file", remote))).hasMessageContaining("400");
    }

    @Test
    void providerAndConversionErrorsNeverExposeSqlSecretsOrRawInputs() {
        when(students.listStudents(teacher)).thenThrow(new IllegalStateException("jdbc password=private-token select users"));
        assertThatThrownBy(() -> read("students.listStudents", Map.of())).hasMessageNotContaining("private-token").hasMessageNotContaining("jdbc").hasMessageContaining("unavailable");
        assertThatThrownBy(() -> service.call("read_site_function", Map.of("functionId", "java.lang.Runtime.exec", "arguments", Map.of("command", "sensitive")), oauth, false))
                .hasMessageContaining("404").hasMessageNotContaining("sensitive");
        when(access.requireActor(null)).thenThrow(new org.springframework.security.access.AccessDeniedException("OAuth required"));
        assertThatThrownBy(() -> service.call("list_site_functions", Map.of(), null, true)).hasMessageContaining("401");
        assertThatThrownBy(() -> service.call("list_site_functions", Map.of(), oauth, true)).hasMessageContaining("401");
    }

    @Test
    void gateDenialCannotReachControllerOrReceiptReplay() {
        doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN, "disabled"))
                .when(targets).check(argThat(function -> function.id().equals("lesson_board.read")), eq(teacher), anyMap());
        assertThatThrownBy(() -> read("lesson_board.read", Map.of("eventId", "lesson"))).hasMessageContaining("403");
        verify(board, never()).read(any(), anyString(), anyLong());
        verifyNoInteractions(receipts);
    }

    @Test
    void uncertainExternalCompletionStaysBlockedWithSafeInspectStateGuidance() {
        doThrow(new McpOperationReceiptService.ExternalOperationPendingException())
                .when(receipts).executeExternal(any(), nullable(UUID.class), anyString(), anyString(), anyMap(), any(), any());
        assertThatThrownBy(() -> write("students.createStudent", Map.of("body", Map.of("fullName", "Pupil"))))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
                .hasMessageContaining("409").hasMessageContaining("Outcome unknown/in progress").hasMessageContaining("newly explicitly requested action");
        verify(students, never()).createStudent(any(), any());
    }

    private Object read(String function, Map<String, Object> arguments) {
        return service.call("read_site_function", Map.of("functionId", function, "arguments", arguments), oauth, false);
    }

    private Object write(String function, Map<String, Object> arguments) {
        return service.call("execute_site_function", Map.of("functionId", function, "arguments", arguments, "confirm", true, "idempotencyKey", "one-action-unique-key"), oauth, false);
    }
}
