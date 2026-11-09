package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class WorkbookMathRepairTest {
    @Test
    void recognizesOnlyMathQaFailuresForAutomaticRepair() {
        assertTrue(MindcraftiMcpController.workbookMathQaFailure(
                new IllegalArgumentException("Workbook generation/QA failed: Algebra QA did not pass")));
        assertTrue(MindcraftiMcpController.workbookMathQaFailure(
                new IllegalStateException("outer", new IllegalArgumentException("Algebra validation rejected task"))));
        assertFalse(MindcraftiMcpController.workbookMathQaFailure(
                new IllegalArgumentException("Generated PDF failed the mandatory layout check")));
        assertFalse(MindcraftiMcpController.workbookMathQaFailure(
                new IllegalArgumentException("Workbook context is stale")));
    }

    @Test
    void repairInstructionIsBoundedAndKeepsStrictMathContract() {
        String repaired=MindcraftiMcpController.workbookMathRepairInstruction("Brüche und Gleichwertigkeit");
        assertTrue(repaired.contains("Brüche und Gleichwertigkeit"));
        assertTrue(repaired.contains("expression = numeric expression with NO '='"));
        assertTrue(repaired.contains("relation = exactly one '=' and NO variables"));
        assertTrue(repaired.contains("equation = exactly one '='"));
        assertTrue(repaired.contains("server computes all reference answers"));
        assertTrue(repaired.length()<=6000);

        String veryLong="x".repeat(7000);
        assertTrue(MindcraftiMcpController.workbookMathRepairInstruction(veryLong).length()<=6000);
    }
}
