package com.mcschool.flashcard.lessons;

import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;

/** The same server exception must produce a useful, stable, non-sensitive status code. */
class PostLessonHomeworkFailureTest {
    private static final String PRIVATE_TEXT = "private-transcript-secret-token";

    static Stream<Arguments> previouslyGenericFailures() {
        return Stream.of(
                Arguments.of("HOMEWORK_AI_EMPTY_RESPONSE", "AI_EMPTY_RESPONSE"),
                Arguments.of("HOMEWORK_AI_REFUSED", "AI_REFUSED"),
                Arguments.of("HOMEWORK_AI_TIMEOUT", "AI_TIMEOUT"),
                Arguments.of("HOMEWORK_AI_RESPONSE_INVALID", "AI_RESPONSE_INVALID"),
                Arguments.of("Workbook content provider returned no structured content", "AI_EMPTY_RESPONSE"),
                Arguments.of("Workbook content request was declined", "AI_REFUSED"),
                Arguments.of("Workbook MathJax runtime is unavailable; configure MINDCRAFTI_WORKBOOK_MODULES", "RENDERER_UNAVAILABLE"),
                Arguments.of("Cannot initialize Mindcrafti workbook renderer runtime", "RENDERER_UNAVAILABLE"),
                Arguments.of("Plain worksheet rendering exceeded its time limit", "RENDERER_TIMEOUT"),
                Arguments.of("Plain worksheet rendering was interrupted", "INTERRUPTED"),
                Arguments.of("HOMEWORK_NO_RECIPIENTS", "NO_RECIPIENTS"),
                Arguments.of("HOMEWORK_STUDENT_CHANGED", "STUDENT_CHANGED"),
                Arguments.of("HOMEWORK_TEACHER_REVOKED", "TEACHER_REVOKED"),
                Arguments.of("HOMEWORK_CLASS_CHANGED", "CLASS_CHANGED"),
                Arguments.of("HOMEWORK_MEMBERSHIP_CHANGED", "MEMBERSHIP_CHANGED"),
                Arguments.of("HOMEWORK_DRAFT_COUNT_MISMATCH", "DRAFT_COUNT_MISMATCH"),
                Arguments.of("School prompt settings are not initialized", "SCHOOL_SETTINGS_MISSING"),
                Arguments.of("Workbook layout profile migration V106 is missing", "SCHOOL_SETTINGS_MISSING"));
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("previouslyGenericFailures")
    void knownFailuresHaveActionableCodes(String message, String expectedCode) {
        assertEquals(expectedCode, PostLessonHomeworkFailure.code(new IllegalStateException(message)));
    }

    static Stream<Arguments> establishedFailures() {
        return Stream.of(
                Arguments.of("HOMEWORK_AI_INCOMPLETE", "AI_UNAVAILABLE"),
                Arguments.of("HOMEWORK_LESSON_EVIDENCE_MISSING", "LESSON_MATERIAL_MISSING"),
                Arguments.of("HOMEWORK_PDF_INVALID", "PDF_INVALID"),
                Arguments.of("HOMEWORK_DRAFT_VALIDATION_FAILED", "HOMEWORK_JSON_INVALID"),
                Arguments.of("HOMEWORK_DRAFT_RENDER_FAILED", "HOMEWORK_JSON_RENDER_INVALID"),
                Arguments.of("HOMEWORK_DRAFT_MATH_QA_FAILED", "HOMEWORK_MATH_QA_FAILED"));
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("establishedFailures")
    void existingStatusCodesStayCompatible(String message, String expectedCode) {
        assertEquals(expectedCode, PostLessonHomeworkFailure.code(new IllegalStateException(message)));
    }

    @Test void httpConflictsAndUnknownErrorsNeverExposeTheirReason() {
        assertEquals("AI_RATE_LIMITED", PostLessonHomeworkFailure.code(
                new IllegalStateException("HOMEWORK_AI_HTTP_429")));
        assertEquals("CONFLICT_409", PostLessonHomeworkFailure.code(
                new ResponseStatusException(HttpStatus.CONFLICT, PRIVATE_TEXT)));
        assertEquals("GENERATION_FAILED", PostLessonHomeworkFailure.code(
                new IllegalStateException(PRIVATE_TEXT)));
    }

    @Test void originFindsApplicationLocationInWrappedFailureWithoutPrivateMessages() {
        IllegalStateException cause = new IllegalStateException(PRIVATE_TEXT);
        cause.setStackTrace(new StackTraceElement[] {
                new StackTraceElement("java.net.http.HttpClient", "send", "HttpClient.java", 1),
                new StackTraceElement("com.mcschool.flashcard.lessons.PostLessonHomeworkContentService",
                        "ask", "PostLessonHomeworkContentService.java", 77)
        });
        IllegalStateException outer = new IllegalStateException(PRIVATE_TEXT, cause);
        outer.setStackTrace(new StackTraceElement[] {
                new StackTraceElement("org.springframework.transaction.support.TransactionTemplate",
                        "execute", "TransactionTemplate.java", 100)
        });

        String origin = PostLessonHomeworkFailure.origin(outer);
        assertTrue(origin.contains("PostLessonHomeworkContentService"));
        assertTrue(origin.contains("ask"));
        assertFalse(origin.contains(PRIVATE_TEXT));
        assertFalse(origin.contains("java.net.http.HttpClient"));
        assertFalse(origin.contains("TransactionTemplate"));
    }

    @Test void originWithoutApplicationFramesStillNeverExposesPrivateMessages() {
        IllegalStateException failure = new IllegalStateException(PRIVATE_TEXT);
        failure.setStackTrace(new StackTraceElement[] {
                new StackTraceElement("org.example.Provider", "request", "Provider.java", 1)
        });
        String origin = PostLessonHomeworkFailure.origin(failure);
        assertNotNull(origin);
        assertFalse(origin.contains(PRIVATE_TEXT));
        assertFalse(origin.contains("org.example.Provider"));
    }
}
