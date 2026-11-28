package com.mcschool.flashcard.lessons;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class StudentOnlyHomeworkTest {
    private final ObjectMapper json=new ObjectMapper();
    private final String source="""
        {"meta":{"school":"MINDCRAFTI SCHOOL","subject":"MATHEMATIK","durationMinutes":30,"homeworkEstimatedMinutes":5},
         "workbookPages":[{"title":"Terme","subtitle":"Vereinfache","blocks":[
           {"type":"exercise","number":1,"title":"Fasse zusammen","rows":[{"label":"","math":{"latex":"2x+3x"},"work":true}],"writeLines":6}]}],
         "teacherPages":[{"title":"Antworten","subtitle":"","blocks":[{"type":"solutions","section":"1","title":"Lösung","items":[{"label":"1","math":{"latex":"5x"}}]}]}],
         "qa":{"algebra":[{"number":1,"kind":"equivalence","expression":"2*x+3*x","answer":"5*x","restrictions":[]}]}}
        """;

    @Test void automaticHomeworkDiscardsTeacherDocumentButKeepsMathQa() throws Exception {
        var author=new WorkbookContentService("","",json);
        String payload=json.writeValueAsString(new WorkbookContentService.Content(source,"lesson evidence",""));
        var content=author.validateContentText(payload,true);
        Map<?,?> doc=json.readValue(content.lessonJson(),Map.class);
        assertEquals(List.of(),doc.get("teacherPages"));
        assertEquals(true,((Map<?,?>)doc.get("meta")).get("homeworkStudentOnly"));
        assertEquals(1,((List<?>)((Map<?,?>)doc.get("qa")).get("algebra")).size());
        assertDoesNotThrow(()->McpHomeworkDraftValidator.normalize(json,content.lessonJson(),7,7,""));
    }

    @Test void normalLessonStillRequiresAndPreservesTeacherPages() throws Exception {
        var author=new WorkbookContentService("","",json);
        String payload=json.writeValueAsString(new WorkbookContentService.Content(source,"lesson evidence",""));
        var normal=author.validateContentText(payload);
        assertFalse(((List<?>)json.readValue(normal.lessonJson(),Map.class).get("teacherPages")).isEmpty());
        var doc=json.readValue(source,Map.class);
        doc.put("teacherPages",List.of());
        assertThrows(IllegalArgumentException.class,()->OwnerWorkbookPdfRenderService.validateDocument(doc));
    }
}
