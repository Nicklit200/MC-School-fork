package com.mcschool.flashcard.lessons.dto;

public record LessonPreparationResponse(
        String eventId,
        String homeworkNotes,
        String difficulties,
        String lessonPlan,
        boolean hasWorkbook,
        String workbookFilename,
        boolean hasAnswers,
        String answersFilename
) {}
