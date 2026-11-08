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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
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
        var content=new KolinTaskService.Content("interactive","Graph",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","untrusted prose","wrong formula",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(content));
        service.reply(host,room,new KolinChatService.Request("Покажи параболу",List.of(),
            new KolinChatService.Context("student",pupil.getId(),0),clientId),new java.util.LinkedHashMap<>(),List.of(),"Покажи параболу",metadata);
        verify(ai,times(1)).kolinStructuredReply(anyString(),anyList(),anyString());
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
        assertThat(KolinTaskService.requestedCount("Нарисуй в PDF один график y=2*x+1")).isEqualTo(1);
        assertThat(KolinTaskService.requestedCount("Покажи две пирамиды",0,1)).isEqualTo(2);
        assertThat(KolinTaskService.requestedCount("Добавь Алисе",3,1)).isEqualTo(3);
        assertThat(KolinTaskService.requestedCount("Сделай её выше",2,1)).isEqualTo(2);
        String mixed="А ну дай задачку на Площадь куба одну интерктивную страницу а другую прост ос пару заданий";
        assertThat(KolinTaskService.requestedCount(mixed,0,5)).isEqualTo(5);
        assertThat(KolinTaskService.requestedCount(mixed,0,1)).isEqualTo(1);
        assertThat(KolinTaskService.requestedCount("Сделай 3 задания в PDF и одну интерактивную страницу",0,1)).isEqualTo(1);
        assertThat(KolinTaskService.requestedCount("Сделай 2 интерактива и 3 задания в PDF",0,5)).isEqualTo(3);
        assertThat(KolinTaskService.requestedCount("Сделай 2 интерактива и 3 задания в PDF",0,1)).isEqualTo(2);
    }
    @Test void mixedRequestPreparesBothMaterialsWithOneCallAndSeparateCounts()throws Exception {
        reserve();
        var interactive=new KolinTaskService.Content("interactive","Исследование",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        var pdf=new KolinTaskService.Content("worksheet","Практика",pupil.getId().toString(),Collections.nCopies(5,task("6*4^2",null)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("materials","Интерактив и задания",null,List.of(),List.of(interactive,pdf))));
        when(renderer.renderPlain(anyString())).thenReturn(new OwnerWorkbookPdfRenderService.PlainWorksheet(new byte[]{1},new byte[]{2},1,
            Map.of("results",Collections.nCopies(5,Map.of("passed",true,"answer","96")))));
        send("А ну дай задачку на Площадь куба одну интерактивную страницу а другую прост ос пару заданий");
        verify(ai).kolinStructuredReply(argThat(json->json.contains("\"requestedPdfTaskCount\":5")&&json.contains("\"requestedInteractiveTaskCount\":1")),anyList(),anyString());
        verify(store).completeMaterials(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("Интерактив и задания"),eq(metadata),
            argThat(parts->parts.size()==2&&parts.get(0).content().tasks().size()==1&&parts.get(1).content().tasks().size()==5
                &&parts.get(1).content().tasks().get(0).answer().equals("96")));
        verify(store,never()).append(any(),any(),any());
    }
    @Test void failedSecondMaterialCannotStoreTheFirstHalf()throws Exception {
        reserve();
        var interactive=new KolinTaskService.Content("interactive","Graph",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        var pdf=new KolinTaskService.Content("worksheet","PDF",pupil.getId().toString(),Collections.nCopies(5,task("1+1",null)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("materials","Both",null,List.of(),List.of(interactive,pdf))));
        when(renderer.renderPlain(anyString())).thenThrow(new IllegalArgumentException("invalid"));
        assertThatThrownBy(()->send("Одну интерактивную страницу и пару заданий")).isInstanceOf(KolinRequestException.class);
        verify(store,never()).completeMaterials(any(),any(),any(),any(),anyString(),any(),anyList());
        verify(store).fail(host,room.getId(),artifact,attempt);
    }
    @Test void staticConeExercisesDoNotRejectAnUnrelatedInteractiveGraph()throws Exception {
        reserve();
        var interactive=new KolinTaskService.Content("interactive","График",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        var cone=Map.<String,Object>of("type","geometry","language","ru","figure","cone","objective","volume",
            "vertices",List.of(),"parameters",List.of(3,4),"index",0);
        var pdf=new KolinTaskService.Content("worksheet","Конусы",pupil.getId().toString(),Collections.nCopies(5,
            new KolinTaskService.Task("visual","","",null,"",List.of(),cone)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("materials","График и PDF",null,List.of(),List.of(interactive,pdf))));
        when(renderer.renderPlain(anyString())).thenReturn(new OwnerWorkbookPdfRenderService.PlainWorksheet(new byte[]{1},new byte[]{2},3,
            Map.of("results",Collections.nCopies(5,Map.of("passed",true,"answer","12*pi")))));
        send("Сделай интерактивный график и PDF с парой задач на объём конуса");
        verify(store).completeMaterials(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("График и PDF"),eq(metadata),anyList());
    }
    @Test void unsupportedCurvedBodyBecomesAnExplanationInsteadOfAMislabelledPolyhedron()throws Exception {
        reserve();
        var content=new KolinTaskService.Content("interactive","Конус",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),Map.of("template","solid","title","Конус","language","ru"))));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(content));
        send("Покажи интерактивный конус с развёрткой");
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("text"),contains("пока не поддерживается"),eq(metadata),
            isNull(),isNull(),eq(0),eq(0),isNull(),isNull());
        verifyNoInteractions(renderer);verify(store,never()).append(any(),any(),any());verify(store,never()).fail(any(),any(),any(),any());
        assertThat(KolinTaskService.unsupportedInteractive("Покажи пирамиду",List.of())).isFalse();
        assertThat(KolinTaskService.unsupportedInteractive("Покажи развёртку пирамиды",List.of())).isTrue();
        assertThat(KolinTaskService.unsupportedInteractive("Развёртка куба",List.of(new KolinTaskService.Task("visual","","",null,"",List.of(),Map.of("template","cube"))))).isFalse();
    }
    @Test @SuppressWarnings("unchecked") void repairsAMissingVertexOnceBeforeCreatingThePrivateDraft()throws Exception {
        reserve();
        var valid=(Map<String,Object>)mapper.readValue(java.nio.file.Files.readString(java.nio.file.Path.of("../frontend/e2e/math-solids.json")),List.class).get(0);
        var invalid=new LinkedHashMap<>(valid);invalid.put("vertices",((List<Map<String,Object>>)valid.get("vertices")).stream().filter(v->!"O".equals(v.get("id"))).toList());
        var before=new KolinTaskService.Content("interactive","Пирамида",pupil.getId().toString(),List.of(new KolinTaskService.Task("visual","","",null,"",List.of(),invalid)));
        var after=new KolinTaskService.Content("interactive","Пирамида",pupil.getId().toString(),List.of(new KolinTaskService.Task("visual","","",null,"",List.of(),valid)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(before),mapper.writeValueAsString(after));
        send("Покажи пирамиду с высотой");
        verify(ai,times(2)).kolinStructuredReply(anyString(),anyList(),anyString());
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("interactive"),eq("Пирамида"),eq(metadata),eq(pupil.getId()),eq("Виталина"),eq(1),eq(1),isNull(),isNull(),anyString());
        verifyNoInteractions(renderer);verify(store,never()).append(any(),any(),any());
    }
    @Test void stopsAfterOneUnsuccessfulRepairAndDoesNotCreateAPreview()throws Exception {
        reserve();
        var broken=new KolinTaskService.Content("interactive","Пирамида",pupil.getId().toString(),List.of(new KolinTaskService.Task("visual","","",null,"",List.of(),Map.of("template","solid","language","ru"))));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(broken));
        assertThatThrownBy(()->send("Покажи пирамиду")).isInstanceOf(KolinRequestException.class);
        verify(ai,times(2)).kolinStructuredReply(anyString(),anyList(),anyString());verify(store).fail(host,room.getId(),artifact,attempt);
        verifyNoInteractions(renderer);verify(store,never()).append(any(),any(),any());
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
    @Test @org.junit.jupiter.api.condition.EnabledIfSystemProperty(named="kolin.mixedFixtureDir",matches=".+")
    void validatesAndExportsCapturedMixedRepliesThroughTheProductionDocumentBuilder()throws Exception {
        var directory=java.nio.file.Path.of(System.getProperty("kolin.mixedFixtureDir"));
        int count=0;
        try(var files=java.nio.file.Files.list(directory.resolve("generated"))) {
            for(var file:files.filter(p->p.toString().endsWith(".json")).toList()) {
                var json=mapper.readTree(java.nio.file.Files.readString(file));
                assertThat(json.path("valid").asBoolean()).as(file.toString()).isTrue();
                var content=mapper.treeToValue(json.path("content"),KolinTaskService.Content.class);
                if("text".equals(content.kind())) continue;
                for(var part:content.materials()==null?List.of(content):content.materials()) {
                    if("interactive".equals(part.kind())) part.tasks().forEach(task->InteractiveTemplateSpec.validate(task.visual()));
                    else java.nio.file.Files.writeString(directory.resolve(json.path("name").asString()+"-document.json"),mapper.writeValueAsString(KolinTaskService.document(part.tasks())));
                    count++;
                }
            }
        }
        assertThat(count).isEqualTo(5);
    }
    @Test @org.junit.jupiter.api.condition.EnabledIfSystemProperty(named="kolin.contextFixtureDir",matches=".+")
    void validatesCapturedCubeRequestsAfterAnUnrelatedFractionsDraft()throws Exception {
        var directory=java.nio.file.Path.of(System.getProperty("kolin.contextFixtureDir"));
        for(int index=1;index<=2;index++) {
            var result=mapper.readTree(java.nio.file.Files.readString(directory.resolve("context-repro-"+index+".json")));
            assertThat(result.path("materials").size()).isEqualTo(2);
            for(var value:result.path("materials")) {
                var part=mapper.treeToValue(value,KolinTaskService.Content.class);
                if("interactive".equals(part.kind())) part.tasks().forEach(task->InteractiveTemplateSpec.validate(task.visual()));
                else {
                    assertThat(part.tasks()).hasSize(5).allSatisfy(task->{
                        assertThat(task.kind()).isEqualTo("visual");
                        assertThat(task.visual()).containsEntry("figure","cube").containsEntry("objective","surface");
                    });
                    java.nio.file.Files.writeString(directory.resolve("context-repro-"+index+"-document.json"),mapper.writeValueAsString(KolinTaskService.document(part.tasks())));
                }
            }
        }
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
        for (String instruction : List.of("Вычисли 2+2", "Вычисли\n2+2", "Вычисли\n\\frac{1}{2}","Ребро ³⁄₂ см","Ребро ٣ см","Ребро Ⅳ см"))
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
    @Test void automaticallyRepairsAnInvalidPdfPartWithoutRegeneratingTheValidInteractive()throws Exception {
        reserve();
        var interactive=new KolinTaskService.Content("interactive","Graph",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        var badTask=new KolinTaskService.Task("expression","Вычислите","6*(1.5)^2",null,"",List.of());
        var invalid=new KolinTaskService.Content("worksheet","Площадь поверхности куба",pupil.getId().toString(),Collections.nCopies(5,badTask));
        var cube=Map.<String,Object>of("type","geometry","language","ru","figure","cube","objective","surface","vertices",List.of(),"parameters",List.of(3),"index",0);
        var repaired=new KolinTaskService.Content("worksheet","Cube",pupil.getId().toString(),Collections.nCopies(5,
            new KolinTaskService.Task("visual","","",null,"",List.of(),cube)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("materials","Both",null,List.of(),List.of(interactive,invalid))),mapper.writeValueAsString(repaired));
        when(renderer.renderPlain(anyString())).thenReturn(new OwnerWorkbookPdfRenderService.PlainWorksheet(new byte[]{1},new byte[]{2},3,
            Map.of("results",Collections.nCopies(5,Map.of("passed",true,"answer","54")))));
        send("Одну интерактивную страницу, другую с парой заданий на площадь куба");
        verify(ai,times(2)).kolinStructuredReply(anyString(),anyList(),anyString());
        verify(ai).kolinStructuredReply(contains("invalidWorksheetDraft"),eq(List.of()),contains("Исправь invalidWorksheetDraft"));
        verify(ai).kolinStructuredReply(contains("\"worksheetRequiresVisual\":true"),eq(List.of()),contains("Исправь invalidWorksheetDraft"));
        verify(renderer,times(1)).renderPlain(anyString());
        verify(store).completeMaterials(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("Both"),eq(metadata),
            argThat(parts->parts.get(0).content().tasks().get(0).visual().equals(InteractiveTemplateSpecTest.graph())
                &&parts.get(1).content().tasks().get(0).answer().equals("54")));
        verify(store,never()).append(any(),any(),any());
    }
    @Test void pdfRepairHasOneAttemptAndCannotChangeTheRecipient()throws Exception {
        reserve();
        var invalid=new KolinTaskService.Content("worksheet","Bad",pupil.getId().toString(),Collections.nCopies(5,task("x=2",null)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(invalid));
        assertThatThrownBy(()->send("Дай пару заданий")).isInstanceOf(KolinRequestException.class);
        verify(ai,times(2)).kolinStructuredReply(anyString(),anyList(),anyString());verifyNoInteractions(renderer);
        clearInvocations(ai,store);
        var wrongTarget=new KolinTaskService.Content("worksheet","Bad target",UUID.randomUUID().toString(),Collections.nCopies(5,task("1+2",null)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(invalid),mapper.writeValueAsString(wrongTarget));
        assertThatThrownBy(()->send("Дай пару заданий")).isInstanceOf(KolinRequestException.class);
        verify(ai,times(2)).kolinStructuredReply(anyString(),anyList(),anyString());verifyNoInteractions(renderer);
        verify(store).fail(host,room.getId(),artifact,attempt);
    }
    @Test void mixedMaterialsShareOneRepairBudget()throws Exception {
        reserve();
        var broken=new KolinTaskService.Content("interactive","Graph",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),Map.of("template","graph","language","ru"))));
        var fixed=new KolinTaskService.Content("interactive","Graph",pupil.getId().toString(),List.of(
            new KolinTaskService.Task("visual","","",null,"",List.of(),InteractiveTemplateSpecTest.graph())));
        var pdf=new KolinTaskService.Content("worksheet","Bad",pupil.getId().toString(),Collections.nCopies(5,task("x=2",null)));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("materials","Both",null,List.of(),List.of(broken,pdf))),mapper.writeValueAsString(fixed));
        assertThatThrownBy(()->send("Одну интерактивную страницу и PDF с парой заданий")).isInstanceOf(KolinRequestException.class);
        verify(ai,times(2)).kolinStructuredReply(anyString(),anyList(),anyString());verifyNoInteractions(renderer);
        verify(store,never()).completeMaterials(any(),any(),any(),any(),anyString(),any(),anyList());
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
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(mapper.writeValueAsString(
            new KolinTaskService.Content("text",explanation,pupil.getId().toString(),List.of())));
        service.reply(host,room,new KolinChatService.Request("Как объяснить второе задание?",List.of(),
            new KolinChatService.Context("student",pupil.getId(),0,"interactive"),clientId),
            new LinkedHashMap<>(),List.of(),"Как объяснить второе задание?",metadata);
        verify(ai).kolinStructuredReply(contains("lastGeneratedWorksheet"),anyList(),anyString());
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("text"),eq(explanation),eq(metadata),
            isNull(),isNull(),eq(0),eq(0),isNull(),isNull());
        verifyNoInteractions(renderer);verify(store,never()).append(any(),any(),any());
    }
    @ParameterizedTest
    @CsvSource({"pdf,Что ты умеешь?", "interactive,Что ты умеешь?",
        "pdf,Как помочь ученице разобраться в дробях?", "interactive,Как объяснить эти 6 заданий?"})
    void ordinaryQuestionsProduceTextWithoutRecipientOrWorksheetInEitherFormat(String format,String question) throws Exception {
        reserve();
        String answer="Я Kolyn. Помогу объяснить тему, разобрать решение и подобрать сложность.";
        // Providers can retain a selected recipient on text replies. It must not be parsed or applied.
        String response=mapper.writeValueAsString(new KolinTaskService.Content("text",answer,"irrelevant recipient",List.of()));
        when(ai.kolinStructuredReply(anyString(),anyList(),anyString())).thenReturn(response);
        service.reply(host,room,new KolinChatService.Request(question,List.of(),
            new KolinChatService.Context("student",pupil.getId(),0,format),clientId),
            new LinkedHashMap<>(),List.of(),question,metadata);
        verify(store).complete(eq(host),eq(room.getId()),eq(artifact),eq(attempt),eq("text"),eq(answer),eq(metadata),
            isNull(),isNull(),eq(0),eq(0),isNull(),isNull());
        verifyNoInteractions(renderer);
        verify(store,never()).append(any(),any(),any());
        verify(store,never()).fail(any(),any(),any(),any());
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
