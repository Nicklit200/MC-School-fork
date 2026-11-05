package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;

public record LessonPreparationResponse(
        String eventId,
        String homeworkNotes,
        String difficulties,
        String lessonPlan,
        String transcriptText,
        boolean hasTranscript,
        String transcriptFilename,
        boolean hasWorkbook,
        String workbookFilename,
        boolean hasAnswers,
        String answersFilename,
        String answersUploadHint,
        Instant siteOpenedAt,
        String coveredMaterial,
        String manualTranscriptText,
        String sonioxTranscriptText,
        boolean success,
        long workbookSizeBytes,
        long workbookVersion,
        long answersSizeBytes,
        long answersVersion
) {
    /** Preserve source compatibility for clients/tests constructing the earlier DTO. */
    public LessonPreparationResponse(String eventId, String homeworkNotes, String difficulties,
            String lessonPlan, String transcriptText, boolean hasTranscript, String transcriptFilename,
            boolean hasWorkbook, String workbookFilename, boolean hasAnswers, String answersFilename,
            String answersUploadHint, Instant siteOpenedAt, String coveredMaterial,
            String manualTranscriptText, String sonioxTranscriptText) {
        this(eventId, homeworkNotes, difficulties, lessonPlan, transcriptText, hasTranscript,
                transcriptFilename, hasWorkbook, workbookFilename, hasAnswers, answersFilename,
                answersUploadHint, siteOpenedAt, coveredMaterial, manualTranscriptText,
                sonioxTranscriptText, true, 0, hasWorkbook ? 1 : 0, 0, hasAnswers ? 1 : 0);
    }
}
