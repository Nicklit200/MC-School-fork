package com.mcschool.flashcard.lessons;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PostLessonHomeworkRecoveryTest {
    @Test void forwardsSpecificMathFailureInsteadOfGenericLayoutAdvice() {
        String code=PostLessonHomeworkContentService.canonicalRenderRejectionCode(
                new IllegalArgumentException("WORKBOOK_RENDER_MATH_ANSWER"));
        assertEquals("WORKBOOK_RENDER_MATH_ANSWER",code);
        assertTrue(PostLessonHomeworkContentService.canonicalRenderRepairAdvice(code)
                .contains("mathematically incorrect"));
    }

    @Test void classifiesVisualAndLayoutFailuresWithoutLeakingSource() {
        assertEquals("WORKBOOK_RENDER_FRACTION_STRIP",
                OwnerWorkbookPdfRenderService.studioFailureCode(
                        "TypeError: Fraction strip needs 0 <= numerator <= denominator, with positive integers"));
        assertEquals("WORKBOOK_RENDER_VISUAL_SPEC",
                OwnerWorkbookPdfRenderService.studioFailureCode("TypeError: Invalid matching index"));
        assertEquals("WORKBOOK_RENDER_LAYOUT_SCHEMA",
                OwnerWorkbookPdfRenderService.studioFailureCode("TypeError: split.columns must total 100%"));
        assertEquals("WORKBOOK_RENDER_INPUT",
                OwnerWorkbookPdfRenderService.studioFailureCode("unclassified private source"));
        assertEquals("WORKBOOK_RENDER_SCHEMA",
                PostLessonHomeworkContentService.canonicalRenderRejectionCode(
                        new IllegalArgumentException("private source")));
    }

    @Test void infrastructureErrorsAreNotMisclassifiedAsRepairableContent() {
        assertNull(PostLessonHomeworkContentService.canonicalRenderRejectionCode(
                new IllegalStateException("Plain worksheet rendering exceeded its time limit")));
        assertEquals("WORKBOOK_RENDER_RUNTIME_UNAVAILABLE",
                PostLessonHomeworkContentService.canonicalRenderRejectionCode(
                        new IllegalArgumentException("WORKBOOK_RENDER_RUNTIME_UNAVAILABLE")));
    }
}
