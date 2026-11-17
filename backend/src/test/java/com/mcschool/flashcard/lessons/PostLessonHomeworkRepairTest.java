package com.mcschool.flashcard.lessons;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Mock OpenAI: verifies local JSON repair without touching pupils, PDF files or providers. */
class PostLessonHomeworkRepairTest {
    private final ObjectMapper json=new ObjectMapper();
    private final HttpClient http=mock(HttpClient.class);
    private final OwnerWorkbookPdfRenderService renderer=mock(OwnerWorkbookPdfRenderService.class);

    private String validDocument() {
        return json.writeValueAsString(Map.of(
            "meta",Map.of("school","MINDCRAFTI SCHOOL","subject","MATHEMATIK",
                    "durationMinutes",30,"homeworkEstimatedMinutes",7),
            "workbookPages",List.of(Map.of("title","Brüche", "subtitle","Berechne.",
                    "blocks",List.of(
                            Map.of("type","callout","label","Merke","text","Erweitere auf den gleichen Nenner."),
                            Map.of("type","exercise","number","01","title","Addiere und kürze.",
                                    "rows",List.of(Map.of("label","","math",Map.of("latex","1/2+1/4"),"work",true)),
                                    "writeLines",6)))),
            "teacherPages",List.of(Map.of("title","Lösungen",
                    "blocks",List.of(Map.of("type","solutions","section","Brüche","title","Lösungen",
                            "items",List.of(Map.of("label","01","text","1/2 + 1/4 = 3/4")))))),
            "qa",Map.of("algebra",List.of(Map.of("kind","equivalence","number",1,
                    "expression","1/2+1/4","answer","3/4","restrictions",List.of())))));
    }

    @SuppressWarnings({"unchecked","rawtypes"})
    private void responses(String... worksheetJson) throws Exception {
        HttpResponse<String>[] replies=new HttpResponse[worksheetJson.length];
        for(int i=0;i<worksheetJson.length;i++){
            replies[i]=mock(HttpResponse.class);
            when(replies[i].statusCode()).thenReturn(200);
            String inner=json.writeValueAsString(Map.of("lessonJson",worksheetJson[i]));
            Map<String,Object> part=Map.of("type","output_text","text",inner);
            Map<String,Object> item=Map.of("content",List.of(part));
            String responseBody=json.writeValueAsString(Map.of(
                    "status","completed","output",List.of(item)));
            when(replies[i].body()).thenReturn(responseBody);
        }
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class)))
                .thenReturn(replies[0],java.util.Arrays.copyOfRange(replies,1,replies.length));
    }

    @Test void repairsInvalidModelJsonBeforeCallingTheSchoolRenderer() throws Exception {
        responses("{}",validDocument());
        var rendered=new OwnerWorkbookPdfRenderService.StudioRender(
                new byte[120],new byte[130],1,1,Map.of());
        when(renderer.renderStudio(anyString())).thenReturn(rendered);
        var service=new PostLessonHomeworkContentService("test-key","gpt-6-luna",json,renderer,http);
        Map<String,Object> evidence=new HashMap<>(Map.of("homeworkPrompt","SCHOOL","teacherNotes","Brüche üben"));
        assertSame(rendered,service.make(evidence,1,3,"Mindcrafti Testschüler"));
        verify(http,times(2)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
        verify(renderer,times(1)).renderStudio(anyString());
    }

    @Test void returnsSpecificFailureAfterThreeRejectedDocuments() throws Exception {
        responses("{}","{}","{}");
        var service=new PostLessonHomeworkContentService("test-key","gpt-6-luna",json,renderer,http);
        var failure=assertThrows(IllegalStateException.class,
                ()->service.make(Map.of("homeworkPrompt","SCHOOL"),1,3,"Mindcrafti Testschüler"));
        assertEquals("HOMEWORK_DRAFT_VALIDATION_FAILED",failure.getMessage());
        verify(renderer,never()).renderStudio(anyString());
        verify(http,times(3)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
    }
}
