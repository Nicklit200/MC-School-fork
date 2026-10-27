package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;
import java.util.UUID;

public record StudentLessonHistoryItem(
        UUID sourceTeacherId,
        String sourceTeacherName,
        String eventId,
        String title,
        String groupName,
        Instant startsAt,
        Instant endsAt,
        boolean hasWorkbook,
        boolean hasAnswers,
        boolean hasTranscript
) {}
