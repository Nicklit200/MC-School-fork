package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.AiLessonPilotService;
import com.mcschool.flashcard.lessons.OwnerWorkbookPdfRenderService;
import com.mcschool.flashcard.users.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class KolinTaskServiceTest {
    private final AiLessonPilotService ai=mock(AiLessonPilotService.class);
    private final KolinTaskRoster roster=mock(KolinTaskRoster.class);
    private final KolinWorksheetStore store=mock(KolinWorksheetStore.class);
    private final OwnerWorkbookPdfRenderService renderer=mock(OwnerWorkbookPdfRenderService.class);
    private final JsonMapper mapper=JsonMapper.builder().build();
    private final KolinTaskService service=new KolinTaskService(ai,roster,store,renderer,mapper);
    private final User teacher=User.activeTeacher("Teacher","teacher@example.test","teacher","hash");
    private final User pupil=User.managedStudent("Виталина",teacher);
    private final OnlineClass room=OnlineClass.forStudent(teacher,"event","event","Дроби",Instant.now(),Instant.now().plusSeconds(3600),pupil);
    private final AuthenticatedUser host=new AuthenticatedUser(teacher.getId(),teacher.getEmail(),Role.TEACHER);
    private final UUID clientId=UUID.randomUUID(),artifact=UUID.randomUUID(),attempt=UUID.randomUUID();
    private final KolinTranscriptContextService.Metadata metadata=KolinTranscriptContextService.unavailable(room).metadata();

    @Test void interactiveTemplateUsesOneProviderCallWithoutPdfRenderingOrAutomaticAppend()throws Exception {
        reserve();
        var content=new KolinTaskService.Content("worksheet","Graph",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","untrusted prose","wrong formula",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        when(ai.kolinInteractiveReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(content));
        service.reply(host,room,new KolinChatService.Request("Покажи параболу",List.of(),
            new KolinChatService.Context("student",pupil.getId(),0,"interactive"),clientId),new java.util.LinkedHashMap<>(),List.of(),"Покажи параболу",metadata);
        verify(ai,times(1)).kolinInteractiveReply(anyString(),anyList(),anyString());
        verifyNoInteractions(renderer);verify(store,never()).append(any(),any(),any());
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("interactive"),eq("Graph"),eq(metadata),eq(pupil.getId()),eq("Виталина"),
            eq(1),eq(1),isNull(),isNull(),argThat(json->!json.contains("untrusted prose")&&!json.contains("wrong formula")));
    }

    @Test void vagueRequestsAreFiveButExplicitNumbersWin() {
        for(String value:List.of("Дай пару заданий","Дай несколько примеров","Дай ещё задания","Дай Виталине задания"))
            assertThat(KolinTaskService.requestedCount(value)).isEqualTo(5);
        assertThat(KolinTaskService.requestedCount("Дай 2 задания на сложение 1/2 и 1/4")).isEqualTo(2);
        assertThat(KolinTaskService.requestedCount("Дай три примера")).isEqualTo(3);
        assertThat(KolinTaskService.requestedCount("Erstelle zwei Aufgaben")).isEqualTo(2);
        assertThat(KolinTaskService.requestedCount("Сделай второе сложнее",3)).isEqualTo(3);
        assertThat(KolinTaskService.requestedCount("Дай пару заданий посложнее",3)).isEqualTo(5);
    }
    @Test void conditionsAreExactlyTheExpressionsPassedToTheVerifierAndAnswersStayPrivate() throws Exception {
        var document=KolinTaskService.document(List.of(task("\\frac{1}{2}+\\frac{1}{4}","3/4")));
        var json=mapper.readTree(mapper.writeValueAsString(document));
        var row=json.path("workbookPages").get(0).path("blocks").get(0).path("rows").get(0);
        assertThat(row.path("math").path("latex").asString()).isEqualTo("\\frac{1}{2}+\\frac{1}{4}");
        assertThat(row.path("work").asBoolean()).isFalse();
        assertThat(json.path("qa").path("algebra").get(0).path("expression").asString()).isEqualTo(row.path("math").path("latex").asString());
        assertThat(row.toString()).doesNotContain("3/4","answer");
        assertThat(json.path("qa").path("algebra").get(0).path("kind").asString()).isEqualTo("expressionValue");
        assertThat(json.path("qa").path("algebra").get(0).has("answer")).isFalse();
    }
    @Test void fiveShortExamplesShareOnePlainPageAndSixUseTwoPages() {
        assertThat((List<?>)KolinTaskService.document(Collections.nCopies(5,task("1+2","3"))).get("workbookPages")).hasSize(1);
        assertThat((List<?>)KolinTaskService.document(Collections.nCopies(6,task("1+2","3"))).get("workbookPages")).hasSize(2);
    }
    @Test void storedReferencesComeFromTheMathEngineRatherThanTheModel() {
        var content=new KolinTaskService.Content("worksheet","Дроби",pupil.getId().toString(),List.of(task("1/2+1/4","999")));
        var verified=KolinTaskService.withVerifiedAnswers(content,Map.of("results",List.of(Map.of("passed",true,"answer","3/4"))));
        assertThat(verified.tasks().get(0).answer()).isEqualTo("3/4");
        assertThat(verified.tasks().get(0).expression()).isEqualTo("1/2+1/4");
        assertThatThrownBy(()->KolinTaskService.withVerifiedAnswers(content,Map.of())).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void unverifiedMathCannotHideInAnInstructionAndEquationsRequireCompleteLinearQa() throws Exception {
        for (String instruction : List.of("Вычисли 2+2", "Вычисли\n2+2", "Вычисли\n\\frac{1}{2}"))
            assertThatThrownBy(()->KolinTaskService.document(List.of(new KolinTaskService.Task("expression",instruction,"1+1","2","",List.of()))))
                    .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->KolinTaskService.document(List.of(task("1+1=2","2")))).isInstanceOf(IllegalArgumentException.class);
        var document=KolinTaskService.document(List.of(new KolinTaskService.Task("equation","Решите уравнение","2*x+1=5","2","x",List.of())));
        assertThat(mapper.writeValueAsString(document)).contains("linearValue","2*x+1=5");
    }
    @Test void durableRetryReturnsTheOriginalResultWithoutAnotherProviderOrRendererCall() throws Exception {
        var cached=new KolinChatService.Reply("text","Уже готово",metadata);
        when(store.begin(eq(host),eq(room.getId()),eq(clientId),anyString())).thenReturn(new KolinWorksheetStore.Reservation(artifact,attempt,cached));
        assertThat(send("Дай пару заданий")).isSameAs(cached);
        verifyNoInteractions(ai,roster,renderer);
    }
    @Test void clarificationIsSavedAndNeverGeneratesOrAppendsAnything() throws Exception {
        reserve();
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn("{\"kind\":\"text\",\"text\":\"По какой теме?\",\"studentId\":null,\"tasks\":[]}");
        send("Дай пару заданий");
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("text"),eq("По какой теме?"),eq(metadata),isNull(),isNull(),eq(0),eq(0),isNull(),isNull());
        verifyNoInteractions(renderer);
        verify(store,never()).append(any(),any(),any());
    }
    @Test void adviceAfterADraftRemainsTextEvenWithInteractiveFormatSelected() throws Exception {
        reserve();
        when(store.previousDraft(host,room.getId())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("worksheet","Уравнения",pupil.getId().toString(),List.of(task("2*x+1=5","2")))));
        String explanation="Это базовое уравнение. Начните с объяснения одинаковых действий с обеими частями.";
        when(ai.kolinInteractiveReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("text",explanation,pupil.getId().toString(),List.of())));
        service.reply(host,room,new KolinChatService.Request("Как объяснить второе задание?",List.of(),
            new KolinChatService.Context("student",pupil.getId(),0,"interactive"),clientId),
            new LinkedHashMap<>(),List.of(),"Как объяснить второе задание?",metadata);
        verify(ai).kolinInteractiveReply(contains("lastGeneratedWorksheet"),anyList(),anyString());
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("text"),eq(explanation),eq(metadata),
            isNull(),isNull(),eq(0),eq(0),isNull(),isNull());
        verifyNoInteractions(renderer);verify(store,never()).append(any(),any(),any());
    }
    @Test void createsOnlyAPrivateArtifactEvenWhenTheMessageSaysAddIt() throws Exception {
        reserve();
        var content=new KolinTaskService.Content("worksheet","Дроби",pupil.getId().toString(),Collections.nCopies(5,task("1/2+1/4","3/4")));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(content));
        byte[] pdf={1,2,3},preview={4,5};
        when(renderer.renderPlain(anyString())).thenReturn(new OwnerWorkbookPdfRenderService.PlainWorksheet(pdf,preview,1,
                Map.of("mathPassed",true,"results",Collections.nCopies(5,Map.of("passed",true,"answer","3/4")))));
        send("Создай и добавь Виталине пару заданий по дробям");
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("worksheet"),eq("Дроби"),eq(metadata),eq(pupil.getId()),eq("Виталина"),eq(5),eq(1),same(pdf),same(preview),anyString());
        verify(store,never()).append(any(),any(),any());
        verify(ai,times(1)).kolinStructuredReply(anyString(),anyList(),anyString());
    }
    @Test void wrongRecipientOrWrongCountCannotReachRenderer() throws Exception {
        reserve();
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
                new KolinTaskService.Content("worksheet","Дроби",UUID.randomUUID().toString(),Collections.nCopies(5,task("1+2","3")))));
        assertThatThrownBy(()->send("Дай пару заданий по дробям")).isInstanceOf(KolinRequestException.class)
                .satisfies(error -> assertThat(((KolinRequestException)error).getErrorCode()).isEqualTo("KOLIN_TASK_INVALID"));
        verifyNoInteractions(renderer);
        verify(store).fail(host,room.getId(),artifact,attempt);
    }
    @Test void renderFailureReportsItsStageWithoutLoggingTaskTextOrRawRendererDetails() throws Exception {
        reserve();
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
                new KolinTaskService.Content("worksheet","Дроби",pupil.getId().toString(),Collections.nCopies(5,task("1/2+1/4","")))));
        when(renderer.renderPlain(anyString())).thenThrow(new IllegalArgumentException("PRIVATE_TASK SECRET_KEY raw renderer output"));
        var logger=(ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger(KolinTaskService.class);
        var logs=new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        logs.start();logger.addAppender(logs);
        try {
            assertThatThrownBy(()->send("Дай пару заданий по дробям")).isInstanceOf(KolinRequestException.class)
                    .hasMessageNotContaining("PRIVATE_TASK").hasMessageNotContaining("SECRET_KEY");
            assertThat(logs.list).hasSize(1);
            assertThat(logs.list.get(0).getFormattedMessage()).contains("stage=RENDER","errorType=IllegalArgumentException",artifact.toString())
                    .doesNotContain("PRIVATE_TASK","SECRET_KEY","raw renderer output","1/2");
            assertThat(logs.list.get(0).getThrowableProxy()).isNull();
        } finally { logger.detachAppender(logs);logs.stop(); }
    }
    @Test void providerFailureUsesADifferentStableCode() {
        reserve();
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenThrow(new IllegalStateException("PRIVATE_PROVIDER_BODY"));
        assertThatThrownBy(()->send("Дай пару заданий по дробям")).isInstanceOf(KolinRequestException.class)
                .satisfies(error -> assertThat(((KolinRequestException)error).getErrorCode()).isEqualTo("KOLIN_GENERATION_FAILED"))
                .hasMessageNotContaining("PRIVATE_PROVIDER_BODY");
    }
    @Test void occupiedRendererIsRetryableCapacityRatherThanAnInvalidTask() throws Exception {
        reserve();
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
                new KolinTaskService.Content("worksheet","Дроби",pupil.getId().toString(),Collections.nCopies(5,task("1/2+1/4","")))));
        when(renderer.renderPlain(anyString())).thenThrow(new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,"PRIVATE_CAPACITY_DETAIL"));
        assertThatThrownBy(()->send("Дай пару заданий по дробям")).isInstanceOf(KolinRequestException.class)
                .satisfies(error -> assertThat(((KolinRequestException)error).getErrorCode()).isEqualTo("KOLIN_BUSY"))
                .hasMessageNotContaining("PRIVATE_CAPACITY_DETAIL");
    }
    private void reserve() {
        when(store.begin(eq(host),eq(room.getId()),eq(clientId),anyString())).thenReturn(new KolinWorksheetStore.Reservation(artifact,attempt,null));
        when(roster.read(room)).thenReturn(List.of(new KolinTaskRoster.Pupil(pupil.getId(),"Виталина")));
    }
    private KolinChatService.Reply send(String text) throws Exception {
        return service.reply(host,room,new KolinChatService.Request(text,List.of(),new KolinChatService.Context("student",pupil.getId(),1),clientId),
                new LinkedHashMap<>(),List.of(),text,metadata);
    }
    private static KolinTaskService.Task task(String expression,String answer) {
        return new KolinTaskService.Task("expression","Вычислите",expression,answer,"",List.of());
    }
}
