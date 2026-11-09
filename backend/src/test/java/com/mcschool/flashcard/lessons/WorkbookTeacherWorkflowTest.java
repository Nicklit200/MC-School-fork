package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.drive.TeacherGoogleDriveDownloadService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanService;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanTargetType;
import com.mcschool.flashcard.monthlyplans.dto.MonthlyPlanResponse;
import com.mcschool.flashcard.settings.*;
import com.mcschool.flashcard.trialleads.FunnelAnalyticsService;
import com.mcschool.flashcard.users.*;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class WorkbookTeacherWorkflowTest {
    private final ObjectMapper json=new ObjectMapper();
    private final User a=User.activeTeacher("Teacher A","a@test.local","a","unused");
    private final User b=User.activeTeacher("Teacher B","b@test.local","b","unused");
    private final User admin=User.bootstrapAdmin("Admin","admin@test.local","unused");
    private final User student=User.managedStudent("Sofia",a);
    private final UserRepository users=mock(UserRepository.class);
    private final McpOAuthService oauth=mock(McpOAuthService.class);
    private final GoogleCalendarLessonService calendar=mock(GoogleCalendarLessonService.class);
    private final LessonPreparationService preparation=mock(LessonPreparationService.class);
    private final LessonPreparationRepository preparations=mock(LessonPreparationRepository.class);
    private final McpAnalyticsService analytics=mock(McpAnalyticsService.class);
    private final McpHomeworkReadService homework=mock(McpHomeworkReadService.class);
    private final MonthlyPlanService plans=mock(MonthlyPlanService.class);
    private final SchoolPromptSettingsService prompts=mock(SchoolPromptSettingsService.class);
    private final SchoolBrandGuideService brand=mock(SchoolBrandGuideService.class);
    private final McpAccessService access=mock(McpAccessService.class);
    private final McpOperationReceiptService receipts=mock(McpOperationReceiptService.class);
    private final WorkbookContentService content=mock(WorkbookContentService.class);
    private final OwnerWorkbookPdfRenderService renderer=mock(OwnerWorkbookPdfRenderService.class);
    private MindcraftiMcpController controller;

    @BeforeEach
    void setup() throws Exception {
        for(User user:List.of(a,b,admin,student)) {
            when(oauth.resolveAccessToken(user.getEmail())).thenReturn(Optional.of(user));
            when(users.findById(user.getId())).thenReturn(Optional.of(user));
            when(access.requireActor(user)).thenReturn(principal(user));
        }
        when(access.requireTeacher(any(),nullable(UUID.class))).thenAnswer(invocation->{
            AuthenticatedUser actor=invocation.getArgument(0);
            UUID target=invocation.getArgument(1);
            if(target==null && actor.role()==Role.TEACHER) target=actor.id();
            if(target==null || actor.role()==Role.TEACHER && !target.equals(actor.id()))
                throw new org.springframework.security.access.AccessDeniedException("Own lessons only");
            return principal(target.equals(a.getId())?a:b);
        });
        when(access.asTeacher(any(),any(),any())).thenAnswer(i->((Supplier<?>)i.getArgument(2)).get());
        Map<String,Object> cache=new HashMap<>();
        when(receipts.execute(any(),any(),anyString(),anyString(),any(),any(),any())).thenAnswer(i->{
            ((Runnable)i.getArgument(5)).run();
            String key=i.getArgument(2)+":"+i.getArgument(3);
            return cache.computeIfAbsent(key,k->((Supplier<?>)i.getArgument(6)).get());
        });
        Instant start=Instant.parse("2026-11-06T12:00:00Z");
        var lesson=new GroupLessonResponse("lesson-a","lesson-a",null,null,student.getId(),"Sofia",List.of(),
                "Sofia Mathematics",start,start.plusSeconds(3600),null,null);
        when(calendar.listGroupLessons(principal(a))).thenReturn(List.of(lesson));
        when(calendar.listGroupLessons(principal(b))).thenReturn(List.of());
        when(plans.get(principal(a),"student",student.getId(),"2026-11")).thenReturn(
                MonthlyPlanResponse.empty(MonthlyPlanTargetType.STUDENT,student.getId(),"2026-11"));
        when(preparations.findByTeacherIdAndEventId(any(),anyString())).thenReturn(Optional.empty());
        when(analytics.studentActivity(any(),anyBoolean(),any(),any(),any())).thenReturn(Map.of("totals",Map.of(),"errors",List.of()));
        when(homework.findStudentHomeworks(any(),anyBoolean(),any(),any(),any())).thenReturn(Map.of("homeworkCount",0,"submittedCount",0));
        when(homework.recentSubmissions(any(),anyBoolean(),any(),anyInt())).thenReturn(Map.of("recentSubmissions",List.of()));
        when(prompts.readForMcp()).thenReturn(new SchoolPromptSettingsResponse("group-current","individual-current","","","workbook-current","",Instant.now()));
        when(brand.readForMcp()).thenReturn(Map.of("guideText","brand-current","base64",Base64.getEncoder().encodeToString("official-guide".getBytes(java.nio.charset.StandardCharsets.UTF_8))));
        String document=json.writeValueAsString(Map.of("meta",Map.of("durationMinutes",60)));
        when(content.generate(anyMap(),anyString())).thenReturn(new WorkbookContentService.Content(document,"", ""));
        when(renderer.create(any(),anyString(),anyString(),anyString(),anyString())).thenAnswer(i->new LinkedHashMap<>(Map.of(
                "draftId","draft-one","eventId","lesson-a","published",false)));
        controller=new MindcraftiMcpController("import-key",json,users,oauth,calendar,preparation,preparations,
                mock(TranscriptLessonGuard.class),mock(TeacherGoogleDriveDownloadService.class),mock(McpHomeworkSeriesService.class),
                analytics,homework,mock(McpHomeworkWriteService.class),plans,prompts,brand,mock(LessonPdfDraftService.class),
                mock(StoryTemplateMasterService.class),mock(StoryTemplateDownloadLinkService.class),mock(FunnelAnalyticsService.class));
        controller.setPersonalWorkbookAccess(access);
        controller.setPersonalWorkbookReceipts(receipts);
        controller.setOwnerWorkbookPdfRenderService(renderer);
        controller.setOwnerWorkbookGeneratorService(new OwnerWorkbookGeneratorService());
        controller.setWorkbookContentService(content);
    }

    @Test
    void ordinaryTeacherCanGenerateOnlyOwnLessonWithoutPublishingAndRetryReusesDraft() throws Exception {
        String token=contextToken();
        Map<String,Object> args=Map.of("eventId","lesson-a","instruction","Mehr Graphen","idempotencyKey","generation-one",
                "lessonJson",preparedJson(),"contextToken",token);
        assertThat(call(a,"generate_lesson_workbook_draft",args)).doesNotContainKey("error");
        assertThat(call(a,"generate_lesson_workbook_draft",args)).doesNotContainKey("error");
        verifyNoInteractions(content);
        verify(renderer,times(1)).create(eq(principal(a)),eq("lesson-a"),anyString(),eq(""),eq(""));
        verifyNoInteractions(preparation);
    }

    @Test
    void queuedTeacherRequestReturnsBeforeCallingAiOrRendererAndPollIsReadOnly() {
        var jobs=mock(WorkbookGenerationJobService.class);
        controller.setWorkbookJobs(jobs);
        String jobId=UUID.randomUUID().toString();
        Map<String,Object> queued=Map.of("jobId",jobId,"status","QUEUED","teacherId",a.getId().toString(),"eventId","lesson-a","published",false);
        when(jobs.enqueue(eq(principal(a)),eq(a.getId()),eq("lesson-a"),eq("queued-one"),anyMap())).thenReturn(queued);
        when(jobs.status(eq(principal(a)),eq(UUID.fromString(jobId)))).thenReturn(queued);
        String token=contextToken();
        assertThat(call(a,"generate_lesson_workbook_draft",Map.of("eventId","lesson-a","idempotencyKey","queued-one",
                "lessonJson",preparedJson(),"contextToken",token))).doesNotContainKey("error");
        assertThat(call(a,"get_lesson_workbook_job",Map.of("jobId",jobId))).doesNotContainKey("error");
        verifyNoInteractions(content,renderer,preparation,receipts);
        verify(jobs).enqueue(eq(principal(a)),eq(a.getId()),eq("lesson-a"),eq("queued-one"),argThat(args->a.getId().toString().equals(args.get("teacherId"))));
    }

    @Test
    void missingChatGptLessonJsonNeverQueuesServerAiGeneration() {
        var jobs=mock(WorkbookGenerationJobService.class);
        controller.setWorkbookJobs(jobs);
        assertThat(call(a,"generate_lesson_workbook_draft",Map.of("eventId","lesson-a","idempotencyKey","no-ai"))).containsKey("error");
        assertThat(call(admin,"generate_lesson_workbook_draft",Map.of("teacherId",a.getId().toString(),
                "eventId","lesson-a","idempotencyKey","admin-no-ai"))).containsKey("error");
        verify(jobs,never()).enqueue(any(),any(),anyString(),anyString(),anyMap());
        verifyNoInteractions(content,renderer,receipts);
    }

    @Test
    void queuedGenerationStillRejectsAnotherTeachersLessonAndMalformedArguments() {
        var jobs=mock(WorkbookGenerationJobService.class);controller.setWorkbookJobs(jobs);
        assertThat(call(b,"generate_lesson_workbook_draft",Map.of("teacherId",a.getId().toString(),"eventId","lesson-a","idempotencyKey","forged"))).containsKey("error");
        assertThat(call(a,"generate_lesson_workbook_draft",Map.of("eventId","lesson-a","idempotencyKey","invalid","lessonJson","{}"))).containsKey("error");
        verify(jobs,never()).enqueue(any(),any(),anyString(),anyString(),anyMap());
        verifyNoInteractions(content,renderer,preparation,receipts);
    }

    @Test
    void teacherBCannotGenerateTeacherALessonAndStudentsHaveNoGeneratorAccess() throws Exception {
        Map<String,Object> args=Map.of("teacherId",a.getId().toString(),"eventId","lesson-a","idempotencyKey","forged");
        assertThat(call(b,"generate_lesson_workbook_draft",args)).containsKey("error");
        assertThat(call(student,"generate_lesson_workbook_draft",args)).containsKey("error");
        verifyNoInteractions(content,renderer,receipts);
    }

    @Test
    void adminCanGenerateForSelectedTeacherAndTeacherCannotFetchSources() throws Exception {
        String token=contextToken();
        assertThat(call(admin,"generate_lesson_workbook_draft",Map.of("teacherId",a.getId().toString(),"eventId","lesson-a",
                "idempotencyKey","admin-gen","lessonJson",preparedJson(),"contextToken",token))).doesNotContainKey("error");
        verify(renderer).create(eq(principal(a)),eq("lesson-a"),anyString(),anyString(),anyString());
        assertThat(call(a,"get_owner_workbook_generator",Map.of())).containsKey("error");
        assertThat(call(admin,"get_owner_workbook_generator",Map.of())).doesNotContainKey("error");
    }

    @Test
    void teacherPreparedJsonUsesServerRendererWithoutAnyApiCall() throws Exception {
        String token=contextToken();
        Map<String,Object> args=Map.of("eventId","lesson-a","idempotencyKey","prepared-one","lessonJson",preparedJson(),"contextToken",token);
        assertThat(call(a,"generate_lesson_workbook_draft",args)).doesNotContainKey("error");
        assertThat(call(a,"generate_lesson_workbook_draft",args)).doesNotContainKey("error");
        verify(renderer).create(eq(principal(a)),eq("lesson-a"),anyString(),eq(""),eq(""));
        verifyNoInteractions(content,preparation);
        when(prompts.readForMcp()).thenReturn(new SchoolPromptSettingsResponse("changed","changed","","","changed","",Instant.now()));
        assertThat(call(a,"generate_lesson_workbook_draft",args)).containsKey("error");
        verify(renderer,times(1)).create(any(),anyString(),anyString(),anyString(),anyString());
    }

    @Test
    void changedSchoolPromptInvalidatesPreparedJsonTokenBeforeRendering() throws Exception {
        String token=contextToken();
        when(prompts.readForMcp()).thenReturn(new SchoolPromptSettingsResponse("group-current","individual-UPDATED","","","workbook-current","",Instant.now()));
        assertThat(call(a,"generate_lesson_workbook_draft",Map.of("eventId","lesson-a","idempotencyKey","stale-one",
                "lessonJson",preparedJson(),"contextToken",token))).containsKey("error");
        verifyNoInteractions(content,renderer,preparation);
    }

    @Test
    void teacherCompatibilityAliasesRequireFreshContextAndIdempotencyAndReuseDraft() throws Exception {
        for(String tool:List.of("generate_workbook","create_lesson_draft")) {
            assertThat(call(a,tool,Map.of("eventId","lesson-a","lessonJson",preparedJson()))).containsKey("error");
        }
        verifyNoInteractions(renderer,content,receipts);
        String token=contextToken();
        Map<String,Object> args=Map.of("eventId","lesson-a","lessonJson",preparedJson(),"contextToken",token,"idempotencyKey","compat-generate-one");
        assertThat(call(a,"generate_workbook",args)).doesNotContainKey("error");
        assertThat(call(a,"generate_workbook",args)).doesNotContainKey("error");
        verify(renderer,times(1)).create(eq(principal(a)),eq("lesson-a"),anyString(),eq(""),eq(""));
        when(prompts.readForMcp()).thenReturn(new SchoolPromptSettingsResponse("changed","changed","","","changed","",Instant.now()));
        assertThat(call(a,"generate_workbook",args)).containsKey("error");
        verify(renderer,times(1)).create(any(),anyString(),anyString(),anyString(),anyString());
        verifyNoInteractions(content,preparation);
    }

    @Test
    void structuredCreateDraftAliasUsesCanonicalRendererAndAdminLegacyMayOmitKeyAndToken() throws Exception {
        String token=contextToken();
        Map<String,Object> args=Map.of("eventId","lesson-a","lessonJson",preparedJson(),"contextToken",token,"idempotencyKey","compat-create-one");
        assertThat(call(a,"create_lesson_draft",args)).doesNotContainKey("error");
        assertThat(call(a,"create_lesson_draft",args)).doesNotContainKey("error");
        verify(renderer,times(1)).create(eq(principal(a)),eq("lesson-a"),anyString(),eq(""),eq(""));
        assertThat(call(admin,"create_lesson_draft",Map.of("teacherId",a.getId().toString(),"eventId","lesson-a","lessonJson",preparedJson()))).doesNotContainKey("error");
        verify(renderer,times(2)).create(eq(principal(a)),eq("lesson-a"),anyString(),eq(""),eq(""));
        verifyNoInteractions(content,preparation);
    }

    @SuppressWarnings("unchecked")
    @Test
    @SuppressWarnings("unchecked")
    void frozenMcpClientsDiscoverAllFourHomeworkActionsUsingExistingTools() {
        Map<String,Object> envelope=call(a,"list_site_functions",Map.of("domain","homework_generator"));
        assertThat(envelope).doesNotContainKey("error");
        Map<String,Object> catalog=(Map<String,Object>)((Map<?,?>)envelope.get("result")).get("structuredContent");
        assertThat(catalog).containsEntry("total",4);
        List<Map<String,Object>> items=(List<Map<String,Object>>)catalog.get("functions");
        assertThat(items).extracting(row->row.get("functionId"))
                .containsExactly("homework_generator.prepare_context","homework_generator.generate_day",
                        "homework_generator.review_series","homework_generator.assign_series");
        assertThat(items).extracting(row->row.get("readOnly"))
                .containsExactly(true,false,true,false);

        for(var item:items){
            String functionId=String.valueOf(item.get("functionId"));
            Map<String,Object> info=call(a,"get_site_function",Map.of("functionId",functionId));
            assertThat(info).doesNotContainKey("error");
            Map<String,Object> described=(Map<String,Object>)((Map<?,?>)info.get("result")).get("structuredContent");
            assertThat(described).containsEntry("functionId",functionId).containsKey("argumentsSchema");
        }
        Map<String,Object> paging=call(a,"list_site_functions",Map.of("domain","homework_generator","limit",2,"offset",1));
        Map<String,Object> page=(Map<String,Object>)((Map<?,?>)paging.get("result")).get("structuredContent");
        assertThat((List<?>)page.get("functions")).hasSize(2);
        verifyNoInteractions(renderer,receipts);
    }

    @Test
    @SuppressWarnings("unchecked")
    void cachedChatClientCanReadCorrectHomeworkPromptAndContextOverExistingSiteBridge() {
        when(prompts.readForMcp()).thenReturn(new SchoolPromptSettingsResponse(
                "group-current","individual-current","","","workbook-current","seven-day-homework-prompt",Instant.now()));
        Map<String,Object> response=call(a,"read_site_function",Map.of(
                "functionId","homework_generator.prepare_context",
                "arguments",Map.of("eventId","lesson-a")));
        assertThat(response).doesNotContainKey("error");
        Map<String,Object> content=(Map<String,Object>)((Map<?,?>)response.get("result")).get("structuredContent");
        assertThat(content).containsEntry("materialType","homework")
                .containsEntry("homeworkPrompt","seven-day-homework-prompt")
                .containsEntry("homeworkDays",7)
                .containsKey("contextToken");
        assertThat(String.valueOf(content.get("nextStep"))).contains("generate_homework_day_draft");
        verifyNoInteractions(renderer,receipts);
    }

    @Test
    void fallbackToolEnforcesOAuthOwnershipAndWriteConfirmationBeforeQueuingAnything() {
        Map<String,Object> listing=call(student,"list_site_functions",Map.of("domain","homework_generator"));
        assertThat(listing).containsKey("error");
        Map<String,Object> чужой=call(b,"read_site_function",Map.of(
                "functionId","homework_generator.prepare_context",
                "teacherId",a.getId().toString(),
                "arguments",Map.of("eventId","lesson-a")));
        assertThat(((Map<?,?>)чужой.get("result")).get("isError")).isEqualTo(true);
        Map<String,Object> missingConfirmation=call(a,"execute_site_function",Map.of(
                "functionId","homework_generator.generate_day",
                "arguments",Map.of("eventId","lesson-a","day",1),
                "idempotencyKey","homework-day-one-bridge"));
        assertThat(((Map<?,?>)missingConfirmation.get("result")).get("isError")).isEqualTo(true);
        Map<String,Object> wrongReadMode=call(a,"read_site_function",Map.of(
                "functionId","homework_generator.assign_series",
                "arguments",Map.of("eventId","lesson-a")));
        assertThat(((Map<?,?>)wrongReadMode.get("result")).get("isError")).isEqualTo(true);
        Map<String,Object> unknown=call(a,"get_site_function",Map.of("functionId","homework_generator.admin_override"));
        assertThat(((Map<?,?>)unknown.get("result")).get("isError")).isEqualTo(true);
        verifyNoInteractions(renderer,receipts);
    }

    private String contextToken() {
        Map<String,Object> envelope=call(a,"prepare_workbook_context",Map.of("eventId","lesson-a"));
        assertThat(envelope).doesNotContainKey("error");
        Map<String,Object> result=(Map<String,Object>)envelope.get("result");
        Map<String,Object> context=(Map<String,Object>)result.get("structuredContent");
        assertThat(context).containsKey("rendererContract");
        return String.valueOf(context.get("contextToken"));
    }

    private String preparedJson() {
        return json.writeValueAsString(Map.of("meta",Map.of("school","MINDCRAFTI SCHOOL","durationMinutes",60),
                "workbookPages",List.of(Map.of("title","Solve","blocks",List.of(Map.of("type","exercise","title","Expand")))),
                "teacherPages",List.of(Map.of("title","Answers","blocks",List.of(Map.of("type","solutions","items",List.of())))),
                "qa",Map.of("algebra",List.of(Map.of("kind","equivalence","expression","(x+3)^2","answer","x^2+6*x+9")))));
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> call(User user,String tool,Map<String,Object> args) {
        return (Map<String,Object>)controller.post("Bearer "+user.getEmail(),null,Map.of("jsonrpc","2.0","id",1,
                "method","tools/call","params",Map.of("name",tool,"arguments",args))).getBody();
    }
    private AuthenticatedUser principal(User user) { return new AuthenticatedUser(user.getId(),user.getEmail(),user.getRole()); }
}
