package com.mcschool.flashcard.lessons;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

class PostLessonHomeworkTaskPlanTest {
    private final ObjectMapper json=new ObjectMapper();

    private Map<String,Object> task(String kind,String title,String expression,String variable,Object visual){
        Map<String,Object> t=new LinkedHashMap<>();
        t.put("kind",kind);t.put("title",title);t.put("description","");
        t.put("expression",expression);t.put("variable",variable);t.put("visual",visual);
        t.put("restrictions",List.of());t.put("sourceReference","Synthetic regression fixture");
        t.put("evidenceStatus","UNCLEAR");return t;
    }
    private Map<String,Object> expression(String value){
        return task("expression","Berechne oder vereinfache",value,"",null);
    }
    private Map<String,Object> day(int n,Map<String,Object>... tasks){
        return Map.of("day",n,"topic","Mathematik","subtitle","Übungsaufgaben",
                "hint",n<5?"Beachte die Rechenregeln.":"","tasks",List.of(tasks));
    }
    @SuppressWarnings("unchecked")
    private List<Map<String,Object>> series(List<Map<String,Object>> days) throws Exception{
        return PostLessonHomeworkTaskPlan.compileSeries(json,Map.of("days",days),
                days.stream().map(d->((Number)d.get("day")).intValue()).toList(),7,"",
                Map.of("preferredLanguage","DE"),false);
    }

    @Test void producesSevenDistinctSinglePageHomeworkInputsAndOrdinaryLessonFixture() throws Exception {
        var graph=Map.of("type","graph","objective","zeros",
                "series",List.of(Map.of("kind","quadratic","parameters",List.of(1,0,-4),"denominator",List.of())),
                "xRange",List.of(-4,4),"yRange",List.of(-5,8));
        var geometry=Map.of("type","geometry","figure","cuboid","objective","volume",
                "vertices",List.of(),"parameters",List.of(3,4,5),"index",0);
        var days=List.of(
                day(1,expression("2/3+5/6"),expression("3/4-1/8")),
                day(2,expression("2^3+3^2")),
                day(3,expression("sqrt(49)+sqrt(16)")),
                day(4,task("equation","Löse die Gleichung","3*x+2=11","x",null)),
                day(5,task("equation","Löse die Gleichung","x^2=9","x",null)),
                day(6,task("visual","Nullstellen","","",graph)),
                day(7,task("visual","Volumen","","",geometry)));
        var plans=series(days);
        assertEquals(7,plans.size());
        Path dir=Path.of("target","homework-generator-smoke");
        Files.createDirectories(dir);
        for(var plan:plans){
            var primary=(Map<?,?>)plan.get("primary");
            String source=(String)primary.get("lessonJson");
            Map<?,?> doc=json.readValue(source,Map.class);
            assertEquals(1,((List<?>)doc.get("workbookPages")).size());
            assertEquals(List.of(),doc.get("teacherPages"));
            assertTrue(OwnerWorkbookPdfRenderService.studentOnlyHomework((Map<String,Object>)doc));
            Files.writeString(dir.resolve("homework-"+plan.get("day")+".json"),source);
        }
        // The same renderer must still create two documents for an ordinary lesson.
        String ordinary="""
            {"meta":{"school":"MINDCRAFTI SCHOOL","subject":"MATHEMATIK","group":"Test","date":"2026-11-28","durationMinutes":30},
             "workbookPages":[{"title":"Terme","subtitle":"Vereinfache","blocks":[
               {"type":"exercise","number":1,"title":"Fasse zusammen","rows":[{"label":"","math":{"latex":"2x+3x"},"work":true}],"writeLines":6}]}],
             "teacherPages":[{"title":"Antworten","subtitle":"","blocks":[{"type":"solutions","section":"1","title":"Lösung","items":[{"label":"1","math":{"latex":"5x"}}]}]}],
             "qa":{"algebra":[{"number":1,"kind":"equivalence","expression":"2*x+3*x","answer":"5*x","restrictions":[]}]}}
            """;
        Map<String,Object> doc=json.readValue(ordinary,Map.class);
        assertEquals(1,OwnerWorkbookPdfRenderService.validateDocument(doc));
        assertFalse(OwnerWorkbookPdfRenderService.studentOnlyHomework(doc));
        Files.writeString(dir.resolve("lesson.json"),ordinary);
    }

    @Test void rejectsSameExpressionWithDifferentFormatting() {
        assertThrows(IllegalArgumentException.class,()->series(List.of(day(1,expression("2*x+3")),day(2,expression("2x + 3")))));
        assertThrows(IllegalArgumentException.class,()->series(List.of(
                day(1,task("equation","Löse","2*x=6","x",null)),
                day(2,task("equation","Löse","6=2x","x",null)))));
    }

    @Test void serverOwnsDisplayedMathAndDoesNotAcceptTexOrAnswers(){
        assertEquals(Map.of("latex","\\frac{2}{3} + {x}^{2} ="),
                PostLessonHomeworkMath.student("2/3+x^2","equivalence",""));
        assertThrows(IllegalArgumentException.class,()->PostLessonHomeworkMath.student("\\frac{2}{3}","equivalence",""));
        assertThrows(IllegalArgumentException.class,()->PostLessonHomeworkMath.student("1+2=3","equivalence",""));
    }

    @Test void sevenDaysUseOneProviderRequestAndRenderingDoesNotCallProvider() throws Exception {
        var fake=org.mockito.Mockito.mock(java.net.http.HttpClient.class);
        @SuppressWarnings("unchecked") var response=(java.net.http.HttpResponse<String>)org.mockito.Mockito.mock(java.net.http.HttpResponse.class);
        List<Map<String,Object>> days=new ArrayList<>();
        for(int day=1;day<=7;day++)days.add(day(day,expression(day+"+10")));
        org.mockito.Mockito.when(response.statusCode()).thenReturn(200);
        org.mockito.Mockito.when(response.body()).thenReturn(json.writeValueAsString(Map.of("status","completed","output",
                List.of(Map.of("content",List.of(Map.of("type","output_text","text",json.writeValueAsString(Map.of("days",days)))))))));
        org.mockito.Mockito.when(fake.send(org.mockito.ArgumentMatchers.any(java.net.http.HttpRequest.class),
                org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any())).thenReturn(response);
        var renderer=org.mockito.Mockito.mock(OwnerWorkbookPdfRenderService.class);
        org.mockito.Mockito.when(renderer.renderHomeworkStudio(org.mockito.ArgumentMatchers.anyString())).thenReturn(
                new OwnerWorkbookPdfRenderService.StudioRender(new byte[200],new byte[0],1,0,Map.of("mathPassed",true,"layoutPassed",true)));
        var service=new PostLessonHomeworkContentService("fake-key","fake-model",json,renderer,fake);
        var plans=service.prepareTaskSeries(Map.of("preferredLanguage","DE"),List.of(1,2,3,4,5,6,7),7,"",stage->{});
        assertEquals(7,plans.size());
        for(var plan:plans)assertEquals(0,service.renderPreparedDay(plan,stage->{}).pdf().teacherPages());
        org.mockito.Mockito.verify(fake,org.mockito.Mockito.times(1)).send(
                org.mockito.ArgumentMatchers.any(java.net.http.HttpRequest.class),
                org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any());
        org.mockito.Mockito.verify(renderer,org.mockito.Mockito.times(7)).renderHomeworkStudio(org.mockito.ArgumentMatchers.anyString());
        assertFalse(PostLessonHomeworkContentService.repairableTaskContent("WORKBOOK_RENDER_LAYOUT_QA"));
        assertTrue(PostLessonHomeworkContentService.repairableTaskContent("WORKBOOK_RENDER_MATH_QA"));
    }

    @Test void twoGroupCapacityIsBounded(){
        assertEquals(2,PostLessonHomeworkJobService.MAX_PARALLEL_JOBS);
        assertEquals(4,PostLessonHomeworkJobService.MAX_PUPILS_PER_JOB);
        assertEquals(4,PostLessonHomeworkContentService.MAX_PARALLEL_AI);
        assertEquals(3,PostLessonHomeworkContentService.MAX_PARALLEL_HOMEWORK_PDF);
    }
}
