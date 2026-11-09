package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import com.mcschool.flashcard.settings.SchoolBrandGuideResponse;
import com.mcschool.flashcard.users.Role;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;
import java.awt.image.BufferedImage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class OwnerWorkbookPdfRenderServiceTest {
    private static Map<String,Object> document(int minutes) {
        return Map.of("meta", Map.of("school", "MINDCRAFTI SCHOOL", "durationMinutes", minutes),
                "workbookPages", List.of(Map.of("blocks", List.of(Map.of("type", "exercise",
                        "rows", List.of(Map.of("label", "a", "math", List.of("1/2", "=", "_____"))))))),
                "teacherPages", List.of(Map.of("blocks", List.of(Map.of("type", "solutions",
                        "items", List.of(Map.of("label", "a", "math", List.of("1/2", "=", "1/2"))))))));
    }

    @Test
    void fourthConcurrentRenderIsRejectedBeforeBrandIoOrDraftCreationAndSlotsAreReleased() throws Exception {
        ObjectMapper json = new ObjectMapper();
        LessonPdfDraftService drafts = mock(LessonPdfDraftService.class);
        SchoolBrandGuideService brand = mock(SchoolBrandGuideService.class);
        var service = new OwnerWorkbookPdfRenderService(json, drafts, brand);
        var teacher = new AuthenticatedUser(UUID.randomUUID(), "teacher@test.local", Role.TEACHER);
        String lesson = json.writeValueAsString(document(60));
        CountDownLatch entered = new CountDownLatch(3), release = new CountDownLatch(1);
        when(brand.readForStaff(teacher)).thenAnswer(invocation -> {
            entered.countDown();
            if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting for test release");
            throw new IllegalStateException("Controlled brand read failure");
        });
        var workers = Executors.newFixedThreadPool(3);
        try {
            var first = workers.submit(() -> assertThrows(IllegalStateException.class,
                    () -> service.create(teacher, "lesson-one", lesson, "", "")));
            var second = workers.submit(() -> assertThrows(IllegalStateException.class,
                    () -> service.create(teacher, "lesson-two", lesson, "", "")));
            var third = workers.submit(() -> assertThrows(IllegalStateException.class,
                    () -> service.create(teacher, "lesson-three", lesson, "", "")));
            assertTrue(entered.await(5, TimeUnit.SECONDS), "All three background render slots should be occupied");
            ResponseStatusException busy = assertThrows(ResponseStatusException.class,
                    () -> service.create(teacher, "lesson-four", lesson, "", ""));
            assertEquals(503, busy.getStatusCode().value());
            assertTrue(busy.getReason().contains("same idempotencyKey"));
            verify(brand, times(3)).readForStaff(teacher);
            verify(brand, never()).pdfForStaff(any());
            verifyNoInteractions(drafts);
            release.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
            third.get(5, TimeUnit.SECONDS);
            assertThrows(IllegalStateException.class,
                    () -> service.create(teacher, "lesson-after-release", lesson, "", ""));
            verify(brand, times(4)).readForStaff(teacher);
            verifyNoInteractions(drafts);
        } finally {
            release.countDown();
            workers.shutdownNow();
        }
    }

    @Test
    void validationFailuresReleaseRenderPermitsWithoutSideEffects() {
        LessonPdfDraftService drafts = mock(LessonPdfDraftService.class);
        SchoolBrandGuideService brand = mock(SchoolBrandGuideService.class);
        var service = new OwnerWorkbookPdfRenderService(new ObjectMapper(), drafts, brand);
        var teacher = new AuthenticatedUser(UUID.randomUUID(), "teacher@test.local", Role.TEACHER);
        for (int request = 0; request < 4; request++) {
            assertThrows(IllegalArgumentException.class,
                    () -> service.create(teacher, "lesson", "{}", "", ""));
        }
        verifyNoInteractions(brand, drafts);
    }

    @Test
    void logoExtractionIsCachedOnlyWhileCurrentBrandGuideRevisionIsUnchanged() throws Exception {
        LessonPdfDraftService drafts=mock(LessonPdfDraftService.class);
        SchoolBrandGuideService brand=mock(SchoolBrandGuideService.class);
        ObjectMapper json=new ObjectMapper();
        var service=new OwnerWorkbookPdfRenderService(json,drafts,brand);
        var teacher=new AuthenticatedUser(UUID.randomUUID(),"teacher@test.local",Role.TEACHER);
        BufferedImage image=new BufferedImage(160,120,BufferedImage.TYPE_INT_RGB);
        byte[] guidePdf=LessonPdfDraftService.render("Guide","Staff",List.of(
                new LessonPdfDraftService.Task("Question","Answer",2)),image,false,"");
        Instant first=Instant.parse("2026-11-05T10:00:00Z");
        when(brand.readForStaff(teacher)).thenReturn(new SchoolBrandGuideResponse("Brand","guide.pdf",true,guidePdf.length,first));
        when(brand.pdfForStaff(teacher)).thenReturn(new SchoolBrandGuideService.BrandGuidePdf("guide.pdf",guidePdf));
        String lesson=json.writeValueAsString(document(60));
        // The module directory has not been injected in this unit test. That runtime
        // failure must occur lazily after a fresh guide read, without saving a draft.
        assertThrows(IllegalStateException.class,()->service.create(teacher,"one",lesson,"",""));
        assertThrows(IllegalStateException.class,()->service.create(teacher,"two",lesson,"",""));
        verify(brand,times(2)).readForStaff(teacher);
        verify(brand,times(1)).pdfForStaff(teacher);
        when(brand.readForStaff(teacher)).thenReturn(new SchoolBrandGuideResponse("Brand changed","guide.pdf",true,guidePdf.length,first.plusSeconds(1)));
        assertThrows(IllegalStateException.class,()->service.create(teacher,"three",lesson,"",""));
        verify(brand,times(3)).readForStaff(teacher);
        verify(brand,times(2)).pdfForStaff(teacher);
        verifyNoInteractions(drafts);
    }

    @Test
    void acceptsActualCalendarDurations() {
        assertEquals(1, OwnerWorkbookPdfRenderService.validateDocument(document(60)));
        assertEquals(1, OwnerWorkbookPdfRenderService.validateDocument(document(90)));
    }

    @Test
    void forbidsHomeworkAndInvalidLengths() {
        var lesson = new java.util.LinkedHashMap<String,Object>(document(90));
        lesson.put("homework", "assign immediately");
        assertThrows(IllegalArgumentException.class,
                () -> OwnerWorkbookPdfRenderService.validateDocument(lesson));
        assertThrows(IllegalArgumentException.class,
                () -> OwnerWorkbookPdfRenderService.validateDocument(document(10)));
    }

    @Test
    void blocksTeacherSolutionsInStudentFile() {
        var lesson = new java.util.LinkedHashMap<String,Object>(document(90));
        lesson.put("workbookPages", List.of(Map.of("blocks", List.of(Map.of("type", "solutions")))));
        assertThrows(IllegalArgumentException.class,
                () -> OwnerWorkbookPdfRenderService.validateDocument(lesson));
    }

    @Test
    void nestedLayoutsCountExercisesAndRejectAnswerLeaks() {
        var lesson = new java.util.LinkedHashMap<String,Object>(document(60));
        lesson.put("workbookPages", List.of(Map.of("blocks",List.of(Map.of("type","split",
                "left",List.of(Map.of("type","taskCard","title","Solve")),
                "right",List.of(Map.of("type","coordinateGrid")))))));
        assertEquals(1,OwnerWorkbookPdfRenderService.validateDocument(lesson));
        lesson.put("workbookPages", List.of(Map.of("blocks",List.of(Map.of("type","grid",
                "children",List.of(Map.of("type","taskCard","children",List.of(Map.of("type","solutions")))))))));
        assertThrows(IllegalArgumentException.class,()->OwnerWorkbookPdfRenderService.validateDocument(lesson));
    }

    @Test
    void visualOnlyWorkbooksCountAsExercisesAndTeacherBlocksStayPrivate() {
        var lesson = new java.util.LinkedHashMap<String,Object>(document(60));
        lesson.put("workbookPages", List.of(Map.of("title","Graphs only","blocks",List.of(
                Map.of("type","visualTask","number",1,"spec",Map.of("type","graph","objective","draw")),
                Map.of("type","visualTask","number",2,"spec",Map.of("type","geometry","figure","triangle"))
        ))));
        assertEquals(2,OwnerWorkbookPdfRenderService.validateDocument(lesson));
        lesson.put("workbookPages",List.of(Map.of("blocks",List.of(Map.of("type","visualTask",
                "number",1,"children",List.of(Map.of("type","teacherNote")))))));
        assertThrows(IllegalArgumentException.class,()->OwnerWorkbookPdfRenderService.validateDocument(lesson));
    }

    @Test
    void plainSupplementUsesNoBrandOrDraftSideEffectsAndReleasesSlotsAfterFailure() throws Exception {
        var drafts = mock(LessonPdfDraftService.class);
        var brand = mock(SchoolBrandGuideService.class);
        var json = new ObjectMapper();
        var renderer = new OwnerWorkbookPdfRenderService(json, drafts, brand);
        for (int retry = 0; retry < 4; retry++) {
            // Runtime is deliberately absent. Plain mode must get this far
            // without fetching a logo, current brand guide or saving a draft.
            assertThrows(IllegalStateException.class,
                    () -> renderer.renderPlain(json.writeValueAsString(document(60))));
        }
        verifyNoInteractions(brand, drafts);
    }

    @Test
    void plainSupplementHasBoundedTasksPagesAndNoTeacherAnswerLeak() {
        var lesson = new java.util.LinkedHashMap<String, Object>(document(60));
        assertEquals(1, OwnerWorkbookPdfRenderService.validatePlainDocument(lesson));
        lesson.put("workbookPages", java.util.Collections.nCopies(11, ((List<?>) lesson.get("workbookPages")).get(0)));
        assertThrows(IllegalArgumentException.class, () -> OwnerWorkbookPdfRenderService.validatePlainDocument(lesson));
        lesson.put("workbookPages", List.of(Map.of("blocks", List.of(Map.of("type", "exercise",
                "rows", java.util.Collections.nCopies(21, Map.of("math", List.of("1", "+", "1"))))))));
        assertThrows(IllegalArgumentException.class, () -> OwnerWorkbookPdfRenderService.validatePlainDocument(lesson));
        lesson.put("workbookPages", List.of(Map.of("blocks", List.of(Map.of("type", "teacherNote")))));
        assertThrows(IllegalArgumentException.class, () -> OwnerWorkbookPdfRenderService.validatePlainDocument(lesson));
    }

    @Test
    void plainSupplementCannotPassWithMissingMathCoverageOrFailedActualLayout() {
        var layout = Map.<String, Object>of("passed", true);
        assertThrows(IllegalStateException.class, () -> OwnerWorkbookPdfRenderService.requirePlainQa(
                Map.of("passed", true, "checked", 0), layout, 5));
        assertThrows(IllegalStateException.class, () -> OwnerWorkbookPdfRenderService.requirePlainQa(
                Map.of("passed", false, "checked", 5), layout, 5));
        assertThrows(IllegalStateException.class, () -> OwnerWorkbookPdfRenderService.requirePlainQa(
                Map.of("passed", true, "checked", 5), Map.of("passed", false), 5));
        assertDoesNotThrow(() -> OwnerWorkbookPdfRenderService.requirePlainQa(
                Map.of("passed", true, "checked", 5), layout, 5));
    }
}
