package com.mcschool.flashcard.lessons;

import java.net.http.HttpTimeoutException;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import org.springframework.web.server.ResponseStatusException;

/** Safe, stable diagnostics. Exception messages can contain private model input. */
final class PostLessonHomeworkFailure {
    private PostLessonHomeworkFailure() {}

    private static final Map<String, String> KNOWN = Map.ofEntries(
            Map.entry("HOMEWORK_AI_EMPTY_RESPONSE", "AI_EMPTY_RESPONSE"),
            Map.entry("Workbook content provider returned no structured content", "AI_EMPTY_RESPONSE"),
            Map.entry("HOMEWORK_AI_REFUSED", "AI_REFUSED"),
            Map.entry("Workbook content request was declined", "AI_REFUSED"),
            Map.entry("HOMEWORK_AI_TIMEOUT", "AI_TIMEOUT"),
            Map.entry("HOMEWORK_AI_RESPONSE_INVALID", "AI_RESPONSE_INVALID"),
            Map.entry("HOMEWORK_AI_HTTP_401", "AI_AUTH_FAILED"),
            Map.entry("HOMEWORK_AI_HTTP_403", "AI_AUTH_FAILED"),
            Map.entry("HOMEWORK_AI_HTTP_429", "AI_RATE_LIMITED"),
            Map.entry("HOMEWORK_RENDERER_UNAVAILABLE", "RENDERER_UNAVAILABLE"),
            Map.entry("Workbook MathJax runtime is unavailable; configure MINDCRAFTI_WORKBOOK_MODULES", "RENDERER_UNAVAILABLE"),
            Map.entry("Cannot initialize Mindcrafti workbook renderer runtime", "RENDERER_UNAVAILABLE"),
            Map.entry("Plain worksheet rendering exceeded its time limit", "RENDERER_TIMEOUT"),
            Map.entry("Plain worksheet rendering was interrupted", "INTERRUPTED"),
            Map.entry("HOMEWORK_JOB_LEASE_LOST", "INTERRUPTED"),
            Map.entry("Workbook layout profile migration V106 is missing", "SCHOOL_SETTINGS_MISSING"),
            Map.entry("School prompt settings are not initialized", "SCHOOL_SETTINGS_MISSING"),
            Map.entry("HOMEWORK_NO_RECIPIENTS", "NO_RECIPIENTS"),
            Map.entry("HOMEWORK_RECIPIENT_AMBIGUOUS", "RECIPIENT_SELECTION_INVALID"),
            Map.entry("HOMEWORK_RECIPIENT_UNKNOWN", "RECIPIENT_SELECTION_INVALID"),
            Map.entry("HOMEWORK_STUDENT_MISSING", "STUDENT_CHANGED"),
            Map.entry("HOMEWORK_STUDENT_CHANGED", "STUDENT_CHANGED"),
            Map.entry("HOMEWORK_TEACHER_REVOKED", "TEACHER_REVOKED"),
            Map.entry("HOMEWORK_CLASS_CHANGED", "CLASS_CHANGED"),
            Map.entry("HOMEWORK_MEMBERSHIP_CHANGED", "MEMBERSHIP_CHANGED"),
            Map.entry("HOMEWORK_DRAFT_COUNT_MISMATCH", "DRAFT_COUNT_MISMATCH"),
            Map.entry("HOMEWORK_LESSON_EVIDENCE_MISSING", "LESSON_MATERIAL_MISSING"),
            Map.entry("HOMEWORK_PDF_INVALID", "PDF_INVALID"),
            Map.entry("Generated PDFs must not be encrypted", "PDF_INVALID"),
            Map.entry("HOMEWORK_DRAFT_VALIDATION_FAILED", "HOMEWORK_JSON_INVALID"),
            Map.entry("HOMEWORK_DRAFT_REPETITION_FAILED", "REPEATED_EXERCISES"),
            Map.entry("HOMEWORK_DIVERSITY_HISTORY_INVALID", "REPEATED_EXERCISES"),
            Map.entry("HOMEWORK_DRAFT_RENDER_FAILED", "HOMEWORK_JSON_RENDER_INVALID"),
            Map.entry("HOMEWORK_DRAFT_MATH_QA_FAILED", "HOMEWORK_MATH_QA_FAILED"));

    static String code(Throwable failure) {
        Throwable current = failure;
        for (int depth = 0; current != null && depth < 8; depth++, current = current.getCause()) {
            String reason = Objects.toString(current.getMessage(), "");
            String known = KNOWN.get(reason);
            if (known != null) return known;
            if (current instanceof HttpTimeoutException) return "AI_TIMEOUT";
            if (current instanceof InterruptedException) return "INTERRUPTED";
            if (current instanceof ResponseStatusException status) {
                if ("Workbook renderer busy".equals(status.getReason())) return "RENDERER_BUSY";
                return "CONFLICT_" + status.getStatusCode().value();
            }
            if (reason.startsWith("HOMEWORK_AI_")) return "AI_UNAVAILABLE";
        }
        return "GENERATION_FAILED";
    }

    /** Source locations, including a wrapped cause, are sufficient to locate unknown failures. */
    static String origin(Throwable failure) {
        LinkedHashSet<String> locations = new LinkedHashSet<>();
        Throwable current = failure;
        for (int depth = 0; current != null && depth < 8; depth++, current = current.getCause()) {
            int frames = 0;
            for (StackTraceElement frame : current.getStackTrace()) {
                if (!frame.getClassName().startsWith("com.mcschool.flashcard.")) continue;
                locations.add(frame.getClassName() + "." + frame.getMethodName() + ":" + frame.getLineNumber());
                if (++frames == 2 || locations.size() >= 8) break;
            }
            if (locations.size() >= 8) break;
        }
        return String.join(" > ", locations);
    }
}
