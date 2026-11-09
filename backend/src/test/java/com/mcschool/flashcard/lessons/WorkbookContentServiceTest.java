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
    void acceptsStructuredContentAndRequiresRealQaAssertions() throws Exception {
        HttpClient http=mock(HttpClient.class);
        HttpResponse<String> response=mock(HttpResponse.class);
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenReturn(response);
        when(response.statusCode()).thenReturn(200);
        var service=new WorkbookContentService("server-secret","configured-model",json,http);
        Map<String,Object> document=new java.util.LinkedHashMap<>(Map.of(
                "meta",Map.of("school","MINDCRAFTI SCHOOL","durationMinutes",60),
                "workbookPages",List.of(Map.of("blocks",List.of(Map.of("type","exercise","title","Expand")))),
                "teacherPages",List.of(Map.of("blocks",List.of(Map.of("type","solutions","items",List.of()))))));
        when(response.body()).thenReturn(providerResponse(document));
        assertThrows(IllegalArgumentException.class,()->service.generate(Map.of("calendarDurationMinutes",60),""));
        document.put("qa",Map.of("algebra",List.of(Map.of("kind","equivalence","expression","(x+3)^2","answer","x^2+6*x+9"))));
        when(response.body()).thenReturn(providerResponse(document));
        var output=service.generate(Map.of("calendarDurationMinutes",60),"Mehr Aufgaben");
        assertTrue(output.lessonJson().contains("qa"));
        assertEquals("Evidenced notes",output.lessonPlan());
        when(response.body()).thenReturn("{\"status\":\"incomplete\",\"output\":[]}");
        assertThrows(IllegalStateException.class,()->service.generate(Map.of(),""));
    }

    private String providerResponse(Map<String,Object> document) {
        String text=json.writeValueAsString(Map.of("lessonJson",json.writeValueAsString(document),
                "lessonPlan","Evidenced notes","difficulties",""));
        return json.writeValueAsString(Map.of("status","completed","output",List.of(
                Map.of("content",List.of(Map.of("type","output_text","text",text))))));
    }
}
