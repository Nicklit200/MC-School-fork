package com.mcschool.flashcard.lessons.dto;

import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
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
        boolean hasTranscript,
        OnlineClassStatus onlineClassStatus,
        Instant actualStartAt,
        Instant actualEndAt
) {
    public StudentLessonHistoryItem(UUID sourceTeacherId, String sourceTeacherName, String eventId,
                                    String title, String groupName, Instant startsAt, Instant endsAt,
                                    boolean hasWorkbook, boolean hasAnswers, boolean hasTranscript) {
        this(sourceTeacherId, sourceTeacherName, eventId, title, groupName, startsAt, endsAt,
                hasWorkbook, hasAnswers, hasTranscript, null, null, null);
    }

    public StudentLessonHistoryItem withExecution(OnlineClassStatus status, Instant actualStart, Instant actualEnd) {
        return new StudentLessonHistoryItem(sourceTeacherId, sourceTeacherName, eventId, title, groupName,
                startsAt, endsAt, hasWorkbook, hasAnswers, hasTranscript, status, actualStart, actualEnd);
    }
}
