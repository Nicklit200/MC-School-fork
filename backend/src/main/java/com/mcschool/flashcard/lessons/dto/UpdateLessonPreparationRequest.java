package com.mcschool.flashcard.lessons.dto;

public record UpdateLessonPreparationRequest(
        String homeworkNotes,
        String difficulties,
        String lessonPlan
) {}
