package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class WorkbookContentServiceTest {
    private final ObjectMapper json=new ObjectMapper();

    @Test
    void missingConfigurationFailsWithoutCallingProvider() {
        HttpClient http=mock(HttpClient.class);
        var service=new WorkbookContentService("","configured-model",json,http);
        assertThrows(IllegalStateException.class,()->service.generate(Map.of(),"more graphs"));
        verifyNoInteractions(http);
    }

    @Test
    void rejectsRefusalAndIncompleteProviderOutput() {
        assertThrows(IllegalStateException.class,()->WorkbookContentService.outputText(Map.of("output",List.of(
                Map.of("content",List.of(Map.of("type","refusal","refusal","declined")))))));
        assertThrows(IllegalStateException.class,()->WorkbookContentService.outputText(Map.of("output",List.of())));
    }

    @Test
    @SuppressWarnings("unchecked")
    void compactTasksBecomeServerOwnedPagesAnswersAndQa() throws Exception {
        HttpClient http=mock(HttpClient.class);
        HttpResponse<String> response=mock(HttpResponse.class);
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenReturn(response);
        when(response.statusCode()).thenReturn(200);
        var service=new WorkbookContentService("server-secret","configured-model",json,http);
        when(response.body()).thenReturn(providerResponse(List.of(
                task("expression","Kürzen","Kürze vollständig.","27/36","3/4",""),
                task("expression","Addieren","Berechne.","2/3+1/4","11/12",""),
                task("equation","","","x-7=-11","-4",""),
                task("expression","Subtrahieren","Berechne.","5/6-1/4","7/12",""))));

        var output=service.generate(Map.of(
                "calendarDurationMinutes",60,"targetName","Sofia","lessonDate","2026-11-09",
                "rendererContract",Map.of("huge","must not be forwarded")),"Mehr Aufgaben");
        Map<String,Object> doc=json.readValue(output.lessonJson(),Map.class);
        assertEquals(60,((Map<String,Object>)doc.get("meta")).get("durationMinutes"));
        assertEquals("Sofia",((Map<String,Object>)doc.get("meta")).get("group"));
        assertEquals(1,((List<?>)doc.get("workbookPages")).size());
        assertEquals(1,((List<?>)doc.get("teacherPages")).size());
        var qa=(Map<String,Object>)doc.get("qa");
        assertEquals(4,((List<?>)qa.get("algebra")).size());
        assertTrue(output.lessonJson().contains("linearSolution"));
        assertTrue(output.lessonJson().contains("x = -4"));
        assertTrue(output.lessonJson().contains("Aufgabe 3"));
        assertTrue(output.lessonJson().contains("Löse die Gleichung."));
        assertTrue(output.lessonJson().contains("3/4"));
        assertEquals("Evidenced notes",output.lessonPlan());

        var request=org.mockito.ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(request.capture(),any(HttpResponse.BodyHandler.class));
        String body=request.getValue().bodyPublisher().orElseThrow().contentLength()>0?"present":"";
        assertEquals("present",body);

        when(response.body()).thenReturn("{\"status\":\"incomplete\",\"output\":[]}");
        assertThrows(IllegalStateException.class,()->service.generate(Map.of(),""));
    }

    @Test
    void rejectsWrongCompactShapeBeforeRendering() throws Exception {
        HttpClient http=mock(HttpClient.class);
        HttpResponse<String> response=mock(HttpResponse.class);
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenReturn(response);
        when(response.statusCode()).thenReturn(200);
        var service=new WorkbookContentService("server-secret","configured-model",json,http);
        when(response.body()).thenReturn(providerResponse(List.of(
                task("expression","1","Aufgabe.","1+1","2",""),
                task("expression","2","Aufgabe.","2+2","4",""),
                task("expression","3","Aufgabe.","3+3","6",""),
                task("equation","4","Aufgabe.","x+1=2=3","1","x"))));
        assertThrows(IllegalArgumentException.class,()->service.generate(Map.of("calendarDurationMinutes",60),""));
    }

    private Map<String,Object> task(String kind,String title,String instruction,String expression,String answer,String variable) {
        return Map.of("kind",kind,"title",title,"instruction",instruction,"expression",expression,
                "answer",answer,"variable",variable,"restrictions",List.of());
    }

    private String providerResponse(List<Map<String,Object>> tasks) {
        String text=json.writeValueAsString(Map.of(
                "title","Brüche","subtitle","Übung","lessonPlan","Evidenced notes","difficulties","",
                "tasks",tasks));
        return json.writeValueAsString(Map.of("status","completed","output",List.of(
                Map.of("content",List.of(Map.of("type","output_text","text",text))))));
    }
}
