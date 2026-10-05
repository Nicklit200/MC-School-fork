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
        Instant siteOpenedAt
) {}
