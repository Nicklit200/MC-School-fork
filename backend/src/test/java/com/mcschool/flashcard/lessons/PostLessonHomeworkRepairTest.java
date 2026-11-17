package com.mcschool.flashcard.lessons;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Offline fake API. Luna supplies tasks; the server builds the canonical MCH3 PDF input. */
class PostLessonHomeworkRepairTest {
    private final ObjectMapper json=new ObjectMapper();
    private final HttpClient http=mock(HttpClient.class);
    private final OwnerWorkbookPdfRenderService renderer=mock(OwnerWorkbookPdfRenderService.class);

    private Map<String,Object> goodContent() {
        return Map.of("topic","Brüche addieren","subtitle","Berechne und kürze.",
            "hint","Erweitere zuerst auf einen gemeinsamen Nenner.",
            "tasks",List.of(Map.of(
                "title","Berechne und kürze.","description","Zeige alle Schritte.",
                "mathTokens",List.of("1/2","+","1/4","=","_____"),
                "expression","1/2+1/4","answer","3/4",
                "solutionText","1/2 + 1/4 = 2/4 + 1/4 = 3/4.",
                "kind","equivalence","variable","")));
    }

    @SuppressWarnings({"unchecked","rawtypes"})
    private void responses(Map<String,Object>... tasks) throws Exception {
        HttpResponse<String>[] replies=new HttpResponse[tasks.length];
        for(int i=0;i<tasks.length;i++){
            replies[i]=mock(HttpResponse.class);
            when(replies[i].statusCode()).thenReturn(200);
            String body=json.writeValueAsString(tasks[i]);
            Map<String,Object> part=Map.of("type","output_text","text",body);
            Map<String,Object> item=Map.of("content",List.of(part));
            String responseBody=json.writeValueAsString(Map.of(
                "status","completed","output",List.of(item)));
            when(replies[i].body()).thenReturn(responseBody);
        }
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class)))
                .thenReturn(replies[0],java.util.Arrays.copyOfRange(replies,1,replies.length));
    }

    @Test void invalidContentAutomaticallyRepairsThenUsesSchoolTemplate() throws Exception {
        responses(Map.of("topic","Brüche","subtitle","Berechne.","hint","Merke","tasks",List.of()),
                goodContent());
        var rendered=new OwnerWorkbookPdfRenderService.StudioRender(
                new byte[120],new byte[130],1,1,Map.of());
        when(renderer.renderStudio(anyString())).thenReturn(rendered);
        var service=new PostLessonHomeworkContentService("test-key","gpt-6-luna",json,renderer,http);
        assertSame(rendered,service.make(Map.of("homeworkPrompt","SCHOOL","teacherNotes","Brüche üben"),
                1,3,"Mindcrafti Testschüler"));
        verify(http,times(2)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
        var capture=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(renderer).renderStudio(capture.capture());
        Map<?,?> document=json.readValue(capture.getValue(),Map.class);
        assertEquals("MINDCRAFTI SCHOOL",((Map<?,?>)document.get("meta")).get("school"));
        assertEquals(true,((Map<?,?>)document.get("meta")).get("homeworkMode"));
        assertEquals(1,((List<?>)document.get("workbookPages")).size());
        assertEquals(1,((List<?>)document.get("teacherPages")).size());
    }

    @Test void returnsSpecificValidationFailureAfterThreeInvalidContentAttempts() throws Exception {
        Map<String,Object> bad=Map.of("topic","Test","subtitle","Test","hint","",
                "tasks",List.of());
        responses(bad,bad,bad);
        var service=new PostLessonHomeworkContentService("test-key","gpt-6-luna",json,renderer,http);
        var failure=assertThrows(IllegalStateException.class,
                ()->service.make(Map.of("homeworkPrompt","SCHOOL"),1,3,"Mindcrafti Testschüler"));
        assertEquals("HOMEWORK_DRAFT_VALIDATION_FAILED",failure.getMessage());
        verify(renderer,never()).renderStudio(anyString());
        verify(http,times(3)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
    }

    @Test void algebraicFractionIsAlwaysStackedInStudentPdfInput() throws Exception {
        var math=PostLessonHomeworkMch3Template.displayMath(
                List.of("(3x-2)/4","÷","3/8","=","_____"));
        assertEquals("\\frac{3x-2}{4} \\div \\frac{3}{8} =",
                math.get("latex"));
        var draft=new java.util.LinkedHashMap<>(goodContent());
        draft.put("topic","Bruchterme dividieren");
        draft.put("tasks",List.of(Map.of(
                "title","Bruchterme dividieren", "description","Berechne.",
                "mathTokens",List.of("(3x-2)/4","÷","3/8","=","_____"),
                "expression","((3*x-2)/4)/(3/8)", "answer","(6*x-4)/3",
                "solutionText","(6x-4)/3", "kind","equivalence","variable","")));
        String jsonResult=PostLessonHomeworkMch3Template.fromContent(
                json,draft,1,3,"Mindcrafti Testschüler");
        Map<?,?> doc=json.readValue(jsonResult,Map.class);
        Map<?,?> page=(Map<?,?>)((List<?>)doc.get("workbookPages")).get(0);
        var blocks=(List<?>)page.get("blocks");
        var task=(Map<?,?>)blocks.get(1);
        var row=(Map<?,?>)((List<?>)task.get("rows")).get(0);
        var rendered=(Map<?,?>)row.get("math");
        assertTrue(((String)rendered.get("latex")).startsWith("\\frac{3x-2}{4}"));
        assertFalse(((String)rendered.get("latex")).contains("(3x-2)/4"));
    }

    @Test void simpleFractionTitlesCannotHideAlgebraOrDivision() throws Exception {
        var wrong=new java.util.LinkedHashMap<>(goodContent());
        wrong.put("tasks",List.of(Map.of(
                "title","Bruch vereinfachen", "description","Vereinfache den Bruch.",
                "mathTokens",List.of("(3x-2)/4","÷","3/8","=","_____"),
                "expression","((3*x-2)/4)/(3/8)", "answer","(6*x-4)/3",
                "solutionText","(6x-4)/3", "kind","equivalence","variable","")));
        var error=assertThrows(IllegalArgumentException.class,
                ()->PostLessonHomeworkMch3Template.fromContent(
                        json,wrong,1,3,"Mindcrafti Testschüler"));
        assertEquals("HOMEWORK_CONTENT_TITLE_MISMATCH_SIMPLE_FRACTION_REQUIRED",
                error.getMessage());
    }

    @Test void ordinaryKuerzenUsesNumericalFraction() throws Exception {
        var draft=new java.util.LinkedHashMap<>(goodContent());
        draft.put("tasks",List.of(Map.of(
                "title","Bruch vereinfachen", "description","Kürze vollständig.",
                "mathTokens",List.of("18/24","=","_____"),
                "expression","18/24", "answer","3/4",
                "solutionText","18/24 = 3/4", "kind","equivalence","variable","")));
        String generated=PostLessonHomeworkMch3Template.fromContent(
                json,draft,1,3,"Mindcrafti Testschüler");
        Map<?,?> doc=json.readValue(generated,Map.class);
        Map<?,?> page=(Map<?,?>)((List<?>)doc.get("workbookPages")).get(0);
        Map<?,?> task=(Map<?,?>)((List<?>)page.get("blocks")).get(1);
        Map<?,?> row=(Map<?,?>)((List<?>)task.get("rows")).get(0);
        assertEquals("\\frac{18}{24} =",
                ((Map<?,?>)row.get("math")).get("latex"));
    }

    @Test void unknownFractionNotationIsRejectedRatherThanShownInline() {
        assertThrows(IllegalArgumentException.class,
                ()->PostLessonHomeworkMch3Template.displayMath(
                        List.of("(3x-2)/4/5","=","_____")));
    }

    @Test void finalDayHasNoTeacherHintInStudentPage()throws Exception {
        Map<String,Object> draft=new java.util.LinkedHashMap<>(goodContent());
        draft.put("hint","");
        String checked=PostLessonHomeworkMch3Template.fromContent(json,draft,3,3,"Testschüler");
        Map<?,?> doc=json.readValue(checked,Map.class);
        var page=(Map<?,?>)((List<?>)doc.get("workbookPages")).get(0);
        assertEquals(1,((List<?>)page.get("blocks")).size());
    }
}
