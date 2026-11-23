package com.mcschool.flashcard.lessons;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Offline tests: only synthetic classroom evidence and mocked AI responses. */
class PostLessonHomeworkGraphicContentTest {
    private final ObjectMapper json = new ObjectMapper();

    private Map<String,Object> graphTask() {
        Map<String,Object> graph=new LinkedHashMap<>();
        graph.put("family","quadratic");
        graph.put("objective","zeros");
        graph.put("coefficients",List.of(1,0,-4));
        graph.put("xRange",List.of(-4,4));
        graph.put("yRange",List.of(-5,7));
        graph.put("at",null);
        graph.put("level",null);
        Map<String,Object> task=new LinkedHashMap<>();
        task.put("title","Bestimme die Nullstellen.");
        task.put("description","Lies sie am Graphen ab.");
        task.put("expression","");
        task.put("answer","");
        task.put("kind","graph");
        task.put("variable","");
        task.put("sourceReference","Transkript 00:34, Parabel auf der Tafel");
        task.put("evidenceStatus","SOLVED_WITH_HELP");
        task.put("visualGraph",graph);
        return task;
    }

    private Map<String,Object> content(int day) {
        return Map.of("topic",day>=5?"Nullstellen der Parabel":"Нули функции",
                "subtitle","Quadratische Funktionen",
                "hint",day>=5?"":"Напоминание: Nullstellen - пересечения с осью X.",
                "tasks",List.of(graphTask()));
    }

    @Test void graphIsRealStructuredVisualTaskWithPrivateServerCalculatedAnswer() throws Exception {
        String generated=PostLessonHomeworkMch3Template.fromContent(
                json,content(1),1,7,"Fictional Pupil");
        Map<?,?> doc=json.readValue(generated,Map.class);
        Map<?,?> page=(Map<?,?>)((List<?>)doc.get("workbookPages")).get(0);
        List<?> blocks=(List<?>)page.get("blocks");
        assertEquals(3,blocks.size());
        assertEquals("callout",((Map<?,?>)blocks.get(0)).get("type"));
        assertEquals("visualTask",((Map<?,?>)blocks.get(1)).get("type"));
        Map<?,?> visual=(Map<?,?>)blocks.get(1);
        Map<?,?> spec=(Map<?,?>)visual.get("spec");
        assertEquals("graph",spec.get("type"));
        assertEquals("zeros",spec.get("objective"));
        assertEquals("ru",spec.get("language"));
        assertEquals("answerLines",((Map<?,?>)blocks.get(2)).get("type"));
        assertEquals(6,((Map<?,?>)blocks.get(2)).get("lines"));
        Map<?,?> qa=(Map<?,?>)doc.get("qa");
        List<?> assertions=(List<?>)qa.get("algebra");
        assertEquals("visualValue",((Map<?,?>)assertions.get(0)).get("kind"));
        assertFalse(generated.contains("Transkript 00:34"));
        assertFalse(generated.contains("x₁=−2"));
    }

    @Test void independentDayHasGermanTaskWithoutHintsOrRussianLabels() throws Exception {
        String generated=PostLessonHomeworkMch3Template.fromContent(
                json,content(7),7,7,"Fictional Pupil");
        Map<?,?> doc=json.readValue(generated,Map.class);
        Map<?,?> page=(Map<?,?>)((List<?>)doc.get("workbookPages")).get(0);
        List<?> blocks=(List<?>)page.get("blocks");
        assertEquals("visualTask",((Map<?,?>)blocks.get(0)).get("type"));
        Map<?,?> spec=(Map<?,?>)((Map<?,?>)blocks.get(0)).get("spec");
        assertEquals("de",spec.get("language"));
    }

    @Test void graphHasOnlyOneIndependentQuestionPerA4Page() {
        Map<String,Object> two=new LinkedHashMap<>(content(1));
        two.put("tasks",List.of(graphTask(),graphTask()));
        var failure=assertThrows(IllegalArgumentException.class,()->
                PostLessonHomeworkMch3Template.fromContent(json,two,1,7,"Fictional Pupil"));
        assertEquals("HOMEWORK_GRAPH_ONE_TASK_PER_PAGE",failure.getMessage());
    }

    @Test void malformedGraphAndSkippedSourceCannotBecomeHomework() {
        Map<String,Object> task=graphTask();
        task.put("evidenceStatus","SKIPPED_AS_TOO_EASY");
        Map<String,Object> candidate=new LinkedHashMap<>(content(1));
        candidate.put("tasks",List.of(task));
        assertEquals("HOMEWORK_SOURCE_NOT_PRACTICED",
                assertThrows(IllegalArgumentException.class,()->
                        PostLessonHomeworkMch3Template.fromContent(json,candidate,1,7,"Fictional"))
                        .getMessage());

        task=graphTask();
        Map<String,Object> visual=new LinkedHashMap<>((Map<String,Object>)task.get("visualGraph"));
        visual.put("family","polynomial");
        task.put("visualGraph",visual);
        candidate.put("tasks",List.of(task));
        assertEquals("HOMEWORK_GRAPH_FAMILY",
                assertThrows(IllegalArgumentException.class,()->
                        PostLessonHomeworkMch3Template.fromContent(json,candidate,1,7,"Fictional"))
                        .getMessage());
    }

    @Test void graphHistoryDetectsDuplicateEvenWithDifferentWording() {
        Map<String,Object> first=graphTask();
        String fingerprint=PostLessonHomeworkSeriesDiversity.taskKey(first);
        assertTrue(fingerprint.contains("graph:quadratic:zeros"));
        Map<String,Object> second=graphTask();
        second.put("title","Anderer Titel");
        var previous=List.of(Map.of("day",1,
                "tasks",List.of(Map.of("expression",fingerprint))));
        var candidate=Map.<String,Object>of("tasks",List.of(second));
        assertEquals(PostLessonHomeworkSeriesDiversity.REPEATED_EXPRESSION,
                assertThrows(IllegalArgumentException.class,()->
                    PostLessonHomeworkSeriesDiversity.validate(candidate,previous,2)).getMessage());
    }

    @Test void schoolMonthlyPlanAloneCannotForceGraphHomework() {
        assertFalse(PostLessonHomeworkContentService.graphDominatesLesson(Map.of(
                "monthlyPlan","Parabeln Graph Nullstellen Scheitelpunkt Graph",
                "transcript","We reduced two fractions.")));
        assertTrue(PostLessonHomeworkContentService.graphDominatesLesson(Map.of(
                "transcript","We opened the graph. The Parabel intersects X at the Nullstellen. "
                        +"Look at the graph and identify the Scheitelpunkt.")));
    }

    @Test void automaticGraphLessonNeverSilentlyTurnsIntoNumericalHomework() throws Exception {
        Map<String,Object> numberTask=Map.of("title","Berechne.","description","Rechne.",
                "expression","2+3","answer","5","kind","equivalence","variable","");
        Map<String,Object> draft=Map.of("topic","Quadratische Funktionen",
                "subtitle","Graphen","hint","Schau dir den Graphen an.",
                "tasks",List.of(numberTask));
        String output=json.writeValueAsString(Map.of("status","completed",
                "output",List.of(Map.of("type","message","content",List.of(
                        Map.of("type","output_text","text",json.writeValueAsString(draft)))))));
        HttpClient http=mock(HttpClient.class);
        @SuppressWarnings("unchecked")
        HttpResponse<String> reply=mock(HttpResponse.class);
        when(reply.statusCode()).thenReturn(200);
        when(reply.body()).thenReturn(output);
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenReturn(reply);
        OwnerWorkbookPdfRenderService renderer=mock(OwnerWorkbookPdfRenderService.class);
        var service=new PostLessonHomeworkContentService("test-key","test-model",json,renderer,http);
        var failure=assertThrows(IllegalStateException.class,()->service.make(
                Map.of("transcript","Wir zeichnen Parabeln und besprechen die Nullstellen. "
                        +"Wir lesen die Werte am Graph und suchen den Scheitelpunkt.",
                        "homeworkPrompt","Practice graphics"),1,7,"Fictional Pupil"));
        assertEquals("HOMEWORK_DRAFT_VALIDATION_FAILED",failure.getMessage());
        verify(renderer,never()).renderStudio(anyString());
        verify(http,times(3)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
    }

    @Test void sourceEvidenceRemainsPrivateInStaffReviewOnly() {
        Map<String,Object> report=PostLessonHomeworkReviewMetadata.build(content(1),Map.of());
        Map<?,?> task=(Map<?,?>)((List<?>)report.get("tasks")).get(0);
        assertEquals("SOLVED_WITH_HELP",task.get("evidenceStatus"));
        assertTrue(String.valueOf(task.get("sourceReference")).contains("00:34"));
        assertFalse(report.toString().contains("x₁=−2"));
    }
}
