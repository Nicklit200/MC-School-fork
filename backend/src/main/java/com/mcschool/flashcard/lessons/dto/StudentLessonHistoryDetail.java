package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;
import java.util.UUID;

public record StudentLessonHistoryDetail(
        UUID sourceTeacherId,
        String sourceTeacherName,
        String eventId,
        String title,
        String groupName,
        Instant startsAt,
        Instant endsAt,
        String homeworkNotes,
        String difficulties,
        String lessonPlan,
        String coveredMaterial,
        String transcriptText,
        boolean hasWorkbook,
        String workbookFilename,
        boolean hasAnswers,
        String answersFilename,
        boolean hasTranscript,
        String transcriptFilename
) {}
