package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

/** Regression checks for safe teacher/admin workbook failure guidance. */
class WorkbookGenerationFailureCodeTest {

    @Test
    void rejectsWrongMathAsMathQaInsteadOfGenericValidation() {
        assertEquals("MATH_QA_FAILED", WorkbookGenerationJobService.failureCode(
                new IllegalArgumentException("Workbook generation/QA failed: Incorrect math in 3a")));
        assertEquals("MATH_QA_FAILED", WorkbookGenerationJobService.failureCode(
                new IllegalArgumentException("Algebra QA did not pass")));
    }

    @Test
    void preservesLayoutAndConfigurationDiagnoses() {
        assertEquals("LAYOUT_QA_FAILED", WorkbookGenerationJobService.failureCode(
                new IllegalArgumentException("Generated PDF failed the mandatory layout check")));
        assertEquals("AI_NOT_CONFIGURED", WorkbookGenerationJobService.failureCode(
                new IllegalStateException("Server content generation is not configured.")));
    }

    @Test
    void stillTreatsBadJsonAndInterruptedGenerationSafely() {
        assertEquals("VALIDATION_FAILED", WorkbookGenerationJobService.failureCode(
                new IllegalArgumentException("Prepared lessonJson must include explicit qa.algebra assertions")));
        assertEquals("GENERATION_FAILED", WorkbookGenerationJobService.failureCode(
                new IllegalStateException("Unclassified renderer error")));
    }
}
