package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Real Java template, packaged renderer, MathJax, SymPy, WeasyPrint and PDF QA.
 * Only the model HTTP transport is fake. No pupil, database or paid API is used.
 */
@EnabledIfEnvironmentVariable(named = "MINDCRAFTI_HOMEWORK_PDF_TEST", matches = "true")
class PostLessonHomeworkPdfIntegrationTest {
    private static final String LEGACY_DISPLAY = "MODEL_LAYOUT_MUST_NOT_RENDER";
    private final ObjectMapper json = new ObjectMapper();

    private Map<String,Object> task(String expression, String answer) {
        return task(expression,answer,"equivalence","");
    }

    private Map<String,Object> task(String expression, String answer, String kind, String variable) {
        return Map.of("title",kind.equals("solution") ? "Löse die Gleichung." : "Berechne und vereinfache.",
                "description","Zeige deine Rechenschritte.","expression",expression,"answer",answer,
                "kind",kind,"variable",variable);
    }

    private List<List<Map<String,Object>>> week() {
        Map<String,Object> legacy = new LinkedHashMap<>(task("1/2+1/4","3/4"));
        // A stale provider response must not control the displayed problem or
        // leak an answer, and no exact "_____" token is required any more.
        legacy.put("mathTokens",List.of(LEGACY_DISPLAY,"=","1237"));
        legacy.put("solutionText",LEGACY_DISPLAY);
        return List.of(
                List.of(task("18/24","3/4"),task("4*x+3*x","7*x")),
                List.of(legacy,task("2*(x+3)","2*x+6")),
                List.of(task("((3*x-2)/4)/(3/8)","(6*x-4)/3"),
                        task("2*x+3=7","2","solution","x")),
                List.of(task("-x^2+3*x^2","2*x^2"),task("sqrt(9)+abs(-2)","5")),
                List.of(task("3*x-8=7","5","solution","x"),task("5/6-1/4","7/12")),
                List.of(task("(7/8)/(7/4)","1/2"),task("3*(2*x-1)","6*x-3")),
                List.of(task("999+238","1237"),task("3*x+1=10","3","solution","x")));
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void buildsAllSevenDailyPdfPairsFromTaskContentWithoutDisplayTokens() throws Exception {
        HttpClient http = mock(HttpClient.class);
        LessonPdfDraftService drafts = mock(LessonPdfDraftService.class);
        SchoolBrandGuideService brand = mock(SchoolBrandGuideService.class);
        var renderer = new OwnerWorkbookPdfRenderService(json,drafts,brand);
        String modules = System.getenv("MINDCRAFTI_WORKBOOK_MODULES");
        assertNotNull(modules,"The integration job must provide the installed MathJax directory");
        ReflectionTestUtils.setField(renderer,"modulesDirectory",modules);
        var service = new PostLessonHomeworkContentService("fake-key","fake-model",json,renderer,http);
        var fixtures = week();
        HttpResponse<String>[] replies = new HttpResponse[7];
        for (int i=0;i<7;i++) {
            Map<String,Object> content = Map.of("topic","Brüche und Terme",
                    "subtitle","Rechne sorgfältig und zeige deine Schritte.",
                    "hint",i<4 ? "Beachte die Rechenregeln. Fasse gleichartige Terme zusammen." : "",
                    "tasks",fixtures.get(i));
            replies[i] = mock(HttpResponse.class);
            when(replies[i].statusCode()).thenReturn(200);
            when(replies[i].body()).thenReturn(json.writeValueAsString(Map.of("status","completed",
                    "output",List.of(Map.of("type","message","content",List.of(
                            Map.of("type","output_text","text",json.writeValueAsString(content))))))));
        }
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class)))
                .thenReturn(replies[0],java.util.Arrays.copyOfRange(replies,1,replies.length));

        Path output = Path.of("target","post-lesson-homework-pdf-integration");
        Files.createDirectories(output);
        for (int day=1;day<=7;day++) {
            var stages = new ArrayList<PostLessonHomeworkStage>();
            final int currentDay = day;
            var pair = assertDoesNotThrow(() -> service.make(Map.of(
                    "homeworkPrompt","Two short tasks with six writing lines each. Private teacher answers.",
                    "dayNumber",currentDay,"totalDays",7),currentDay,7,"Fictional Test Pupil",stages::add),
                    "The real server pipeline must complete day " + day);
            assertEquals(List.of(PostLessonHomeworkStage.AI_CONTENT,
                    PostLessonHomeworkStage.CONTENT_VALIDATION,PostLessonHomeworkStage.PDF_RENDER),stages,
                    "Valid task code must render without a second model call on day " + day);
            assertEquals(1,pair.studentPages(),"Student page count on day " + day);
            assertEquals(1,pair.teacherPages(),"Teacher page count on day " + day);
            assertEquals(true,pair.qa().get("mathPassed"));
            assertEquals(true,pair.qa().get("layoutPassed"));
            assertEquals(2,((Number)pair.qa().get("algebraChecked")).intValue());
            assertTrue(pair.studentPdf().length>1000);
            assertTrue(pair.teacherPdf().length>1000);
            Files.write(output.resolve("day-"+day+"-student.pdf"),pair.studentPdf());
            Files.write(output.resolve("day-"+day+"-teacher.pdf"),pair.teacherPdf());
            Files.writeString(output.resolve("day-"+day+"-qa.json"),json.writeValueAsString(pair.qa()));

            try (PDDocument student = Loader.loadPDF(pair.studentPdf());
                 PDDocument teacher = Loader.loadPDF(pair.teacherPdf())) {
                assertFalse(student.isEncrypted());
                assertFalse(teacher.isEncrypted());
                assertEquals(595.28,student.getPage(0).getMediaBox().getWidth(),1.0);
                assertEquals(841.89,student.getPage(0).getMediaBox().getHeight(),1.0);
                String studentText = new PDFTextStripper().getText(student);
                String teacherText = new PDFTextStripper().getText(teacher);
                assertTrue(studentText.contains("Brüche und Terme"));
                assertFalse(studentText.contains("Nur für Lehrkräfte"));
                assertFalse(studentText.contains("Fictional Test Pupil"));
                assertFalse(studentText.contains(LEGACY_DISPLAY));
                assertFalse(teacherText.contains(LEGACY_DISPLAY));
                assertFalse(studentText.contains("1237"),"A private answer must not enter a pupil PDF");
                assertTrue(teacherText.contains("Nur für Lehrkräfte"));
                if (day==7) assertTrue(teacherText.contains("1237"),"The teacher receives the checked answer");
                if (day>=5) assertFalse(studentText.contains("Beachte die Rechenregeln"));
            }
        }
        verify(http,times(7)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
        verifyNoInteractions(drafts,brand);
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void aSingleRootOfANonlinearEquationCannotBecomeAnApprovedHomeworkPdf() throws Exception {
        HttpClient http = mock(HttpClient.class);
        LessonPdfDraftService drafts = mock(LessonPdfDraftService.class);
        SchoolBrandGuideService brand = mock(SchoolBrandGuideService.class);
        var renderer = new OwnerWorkbookPdfRenderService(json,drafts,brand);
        ReflectionTestUtils.setField(renderer,"modulesDirectory",System.getenv("MINDCRAFTI_WORKBOOK_MODULES"));
        var service = new PostLessonHomeworkContentService("fake-key","fake-model",json,renderer,http);
        Map<String,Object> content = Map.of("topic","Gleichungen", "subtitle","Löse sorgfältig.",
                "hint","Prüfe deine Lösung durch Einsetzen.",
                "tasks",List.of(task("x^2=4","2","solution","x")));
        HttpResponse<String> reply = mock(HttpResponse.class);
        when(reply.statusCode()).thenReturn(200);
        when(reply.body()).thenReturn(json.writeValueAsString(Map.of("status","completed",
                "output",List.of(Map.of("type","message","content",List.of(
                        Map.of("type","output_text","text",json.writeValueAsString(content))))))));
        when(http.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenReturn(reply);

        IllegalStateException failure = assertThrows(IllegalStateException.class,() -> service.make(
                Map.of("homeworkPrompt","Linear equations with one unique solution."),1,7,"Fictional Test Pupil"));
        assertEquals("HOMEWORK_DRAFT_MATH_QA_FAILED",failure.getMessage());
        verify(http,times(3)).send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class));
        verifyNoInteractions(drafts,brand);
    }
}
