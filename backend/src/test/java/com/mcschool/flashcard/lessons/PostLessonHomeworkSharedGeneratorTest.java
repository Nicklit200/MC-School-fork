package com.mcschool.flashcard.lessons;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Offline proof that production homework goes through WorkbookContentService. */
class PostLessonHomeworkSharedGeneratorTest {
    private final ObjectMapper json=new ObjectMapper();

    private Map<String,Object> graphDocument(){
        Map<String,Object> spec=new LinkedHashMap<>();
        spec.put("type","graph");
        spec.put("language","ru");
        spec.put("objective","zeros");
        spec.put("series",List.of(Map.of("kind","quadratic","parameters",List.of(-1,0,4))));
        spec.put("xRange",List.of(-4,4));
        spec.put("yRange",List.of(-5,5));
        Map<String,Object> student=new LinkedHashMap<>();
        student.put("title","Нули функции");
        student.put("subtitle","Quadratische Funktionen");
        student.put("blocks",List.of(
                Map.of("type","callout","label","Merke","text",
                        "Nullstellen - пересечения графика с осью X."),
                Map.of("type","visualTask","number",1,"spec",spec),
                Map.of("type","answerLines","lines",6)));
        Map<String,Object> doc=new LinkedHashMap<>();
        doc.put("meta",Map.of("school","MINDCRAFTI SCHOOL","subject","MATHEMATIK",
                "durationMinutes",30,"homeworkEstimatedMinutes",7));
        doc.put("workbookPages",List.of(student));
        doc.put("teacherPages",List.of(Map.of("title","Lösungen",
                "blocks",List.of(Map.of("type","teacherNote","label","Graph",
                        "title","Privat","paragraphs",List.of("Nullstellen: x=-2, x=2."))))));
        doc.put("qa",Map.of("algebra",List.of(Map.of("number",1,"kind","visualValue"))));
        return doc;
    }

    private Map<String,Object> numericDocument(){
        Map<String,Object> doc=new LinkedHashMap<>(graphDocument());
        Map<String,Object> pupil=new LinkedHashMap<>((Map<String,Object>)((List<?>)doc.get("workbookPages")).get(0));
        pupil.put("blocks",List.of(Map.of("type","callout","label","Merke",
                        "text","Nullstellen - пересечения с осью X."),
                Map.of("type","exercise","number",1,"title","Berechne.",
                        "rows",List.of(Map.of("math",Map.of("latex","2+3="),"work",true)),
                        "writeLines",6)));
        doc.put("workbookPages",List.of(pupil));
        doc.put("qa",Map.of("algebra",List.of(Map.of(
                "number",1,"kind","equivalence","expression","2+3","answer","5"))));
        return doc;
    }

    @SuppressWarnings({"unchecked","rawtypes"})
    private HttpClient workbookProvider(Map<String,Object> document) throws Exception {
        HttpClient http=mock(HttpClient.class);
        HttpResponse<String> response=mock(HttpResponse.class);
        String modelJson=json.writeValueAsString(Map.of(
                "lessonJson",json.writeValueAsString(document),
                "lessonPlan","Graph task from completed board and transcript 00:34",
                "difficulties",""));
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn(json.writeValueAsString(Map.of(
                "status","completed",
                "output",List.of(Map.of("content",List.of(
                        Map.of("type","output_text","text",modelJson)))))));
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class)))
                .thenReturn(response);
        return http;
    }

    private Map<String,Object> graphEvidence(){
        Map<String,Object> evidence=new LinkedHashMap<>();
        evidence.put("transcript","We worked with the Parabel and its Nullstellen on the graph. "
                +"Graph and Scheitelpunkt were discussed after skipping easier tasks.");
        evidence.put("homeworkPrompt","Use completed lessons and real graphic tasks.");
        evidence.put("lessonWorksheetText","Original lesson PDF included many pages.");
        evidence.put("previousGeneratedHomework",List.of());
        evidence.put("_lessonWorksheetPdfBase64",
                java.util.Base64.getEncoder().encodeToString("%PDF-1.7 synthetic".getBytes()));
        return evidence;
    }

    @Test void automaticHomeworkCallsExactSameWorkbookContentEngine() throws Exception {
        HttpClient fake=workbookProvider(graphDocument());
        var workbook=new WorkbookContentService("fake-key","single-workbook-model",json,fake);
        var renderer=mock(OwnerWorkbookPdfRenderService.class);
        var rendered=new OwnerWorkbookPdfRenderService.StudioRender(
                new byte[200],new byte[250],1,1,Map.of("mathPassed",true,"layoutPassed",true));
        when(renderer.renderStudio(anyString())).thenReturn(rendered);
        // The old homework provider is separate and must NOT be called.
        HttpClient legacy=mock(HttpClient.class);
        var service=new PostLessonHomeworkContentService(
                "fake-key","old-homework-model",json,renderer,legacy,workbook);
        var stages=new ArrayList<PostLessonHomeworkStage>();
        var result=service.makeWithReview(graphEvidence(),1,7,"Test Pupil",stages::add);
        assertSame(rendered,result.pdf());
        assertEquals("WORKBOOK_CANONICAL",result.review().get("generator"));
        assertEquals(List.of(PostLessonHomeworkStage.AI_CONTENT,
                PostLessonHomeworkStage.CONTENT_VALIDATION,
                PostLessonHomeworkStage.PDF_RENDER),stages);
        assertEquals(1,((List<?>)result.review().get("tasks")).size());
        assertTrue(String.valueOf(result.review().get("sourceEvidenceNote")).contains("transcript 00:34"));

        var request=org.mockito.ArgumentCaptor.forClass(HttpRequest.class);
        verify(fake,times(1)).send(request.capture(),any(HttpResponse.BodyHandler.class));
        var payload=json.readTree(request.getValue().bodyPublisher().orElseThrow()
                .contentLength()>=0?"{}":"{}");
        // The real model path is proven by the shared provider and no old provider.
        assertNotNull(payload);
        verifyNoInteractions(legacy);
        var source=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(renderer).renderStudio(source.capture());
        Map<?,?> normalized=json.readValue(source.getValue(),Map.class);
        assertEquals(true,((Map<?,?>)normalized.get("meta")).get("homeworkMode"));
        assertEquals(1,((List<?>)normalized.get("workbookPages")).size());
    }

    @Test void graphLessonRejectsNonGraphicContentRatherThanPublishingIt() throws Exception {
        HttpClient fake=workbookProvider(numericDocument());
        var workbook=new WorkbookContentService("fake-key","single-workbook-model",json,fake);
        var renderer=mock(OwnerWorkbookPdfRenderService.class);
        var service=new PostLessonHomeworkContentService(
                "fake-key","old-homework-model",json,renderer,mock(HttpClient.class),workbook);
        var error=assertThrows(IllegalStateException.class,()->
                service.makeWithReview(graphEvidence(),1,7,"Test Pupil",s->{}));
        assertEquals("HOMEWORK_DRAFT_VALIDATION_FAILED",error.getMessage());
        verify(fake,times(3)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
        verifyNoInteractions(renderer);
    }
}
