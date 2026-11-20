package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Real renderer diagnostic shapes, with fictional private content. No network or PDF publication. */
class OwnerWorkbookStudioFailureTest {
    @TempDir Path workspace;

    private ProcessBuilder exited(int status) throws Exception {
        Process process = mock(Process.class);
        when(process.waitFor(115, TimeUnit.SECONDS)).thenReturn(true);
        when(process.exitValue()).thenReturn(status);
        ProcessBuilder builder = mock(ProcessBuilder.class);
        when(builder.start()).thenReturn(process);
        return builder;
    }

    private String rejection(String output) throws Exception {
        Path log = workspace.resolve("renderer.log");
        Files.writeString(log, output);
        var error = assertThrows(IllegalArgumentException.class,
                () -> OwnerWorkbookPdfRenderService.runStudioProcess(exited(1), log));
        assertNull(error.getCause(), "Raw process diagnostics must not escape through a cause");
        return error.getMessage();
    }

    @Test void wrongAnswerProducesActionableFixedReasonWithoutSourceText() throws Exception {
        String reason = rejection("Private pupil: Fictional Student; original expression: 1/2+1/4\n"
                + "Error: Algebra QA failed: {\"passed\": false, \"results\": [{\"error\": "
                + "\"Expressions are not equivalent\"}]}\n    at ChildProcess.<anonymous>");
        assertEquals("WORKBOOK_RENDER_MATH_ANSWER", reason);
        assertFalse(reason.contains("Fictional"));
        assertFalse(reason.contains("1/2"));
    }

    @Test void domainAndUnsupportedMathRequireDifferentRepairs() throws Exception {
        assertEquals("WORKBOOK_RENDER_MATH_DOMAIN", rejection(
                "Error: Algebra QA failed: {\"error\": \"Missing domain restriction: x != 3\"}"));
        assertEquals("WORKBOOK_RENDER_MATH_SYNTAX", rejection(
                "Error: Algebra QA failed: {\"error\": \"Unsupported algebra syntax\"}"));
        assertEquals("WORKBOOK_RENDER_MATH_QA", rejection(
                "Error: Algebra QA failed: {\"error\": \"Unexpected private diagnostic\"}"));
    }

    @Test void mathDisplayAndPhysicalLayoutAreNotReportedAsWrongAnswers() throws Exception {
        assertEquals("WORKBOOK_RENDER_MATH_DISPLAY", rejection(
                "Error: MathJax must return exactly one complete SVG"));
        assertEquals("WORKBOOK_RENDER_LAYOUT_QA", rejection(
                "Error: WeasyPrint PDF failed: ValueError: Layout QA failed: Page 1: content overlaps footer"));
        assertEquals("WORKBOOK_RENDER_SCHEMA", rejection(
                "TypeError: Unknown workbook block: private-source-text"));
    }

    @Test void nonlinearAndNonuniqueEquationsNeedReplacementWithALinearTask() throws Exception {
        assertEquals("WORKBOOK_RENDER_MATH_LINEAR", rejection(
                "Error: Algebra QA failed: {\"error\": \"A linear task requires a nonconstant affine difference\"}"));
        assertEquals("WORKBOOK_RENDER_MATH_LINEAR", rejection(
                "Error: Algebra QA failed: {\"error\": \"A linear task must contain exactly one variable\"}"));
    }

    @Test void missingRuntimeIsNotAContentRepair() throws Exception {
        assertEquals("WORKBOOK_RENDER_RUNTIME_UNAVAILABLE", rejection(
                "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mathjax' imported from private-path"));
    }

    @Test void onlyBoundedLogTailIsNeededAndUnknownTextIsNeverReturned() throws Exception {
        assertEquals("WORKBOOK_RENDER_MATH_ANSWER", rejection("private-prefix".repeat(6000)
                + "\nError: Algebra QA failed: {\"error\": \"Expressions are not equivalent\"}"));
        assertEquals("WORKBOOK_RENDER_INPUT", rejection("private transcript and unknown error"));
        var missing = assertThrows(IllegalArgumentException.class,
                () -> OwnerWorkbookPdfRenderService.runStudioProcess(exited(1), workspace.resolve("missing.log")));
        assertEquals("WORKBOOK_RENDER_INPUT", missing.getMessage());
    }

    @Test void successfulProcessDoesNotRequireOrInspectAnErrorLog() throws Exception {
        assertDoesNotThrow(() -> OwnerWorkbookPdfRenderService.runStudioProcess(
                exited(0), workspace.resolve("missing.log")));
    }
}
