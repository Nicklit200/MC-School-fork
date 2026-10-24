package com.mcschool.flashcard.lessons.dto;

public record UpdateLessonPreparationRequest(
        String homeworkNotes,
        String difficulties,
        String lessonPlan,
        String transcriptText,
        String coveredMaterial
) {
    /** Clients which do not send this new field retain the existing covered material. */
    public UpdateLessonPreparationRequest(String homeworkNotes, String difficulties,
                                         String lessonPlan, String transcriptText) {
        this(homeworkNotes, difficulties, lessonPlan, transcriptText, null);
    }
}
