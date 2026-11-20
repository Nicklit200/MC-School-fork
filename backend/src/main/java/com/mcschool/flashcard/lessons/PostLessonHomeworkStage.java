package com.mcschool.flashcard.lessons;

/** Fixed diagnostic values only. Never store lesson content in a job's progress. */
enum PostLessonHomeworkStage {
    RECIPIENT_SELECTION,
    LESSON_EVIDENCE,
    AI_CONTENT,
    CONTENT_VALIDATION,
    PDF_RENDER,
    PDF_STORAGE,
    PUBLICATION
}
