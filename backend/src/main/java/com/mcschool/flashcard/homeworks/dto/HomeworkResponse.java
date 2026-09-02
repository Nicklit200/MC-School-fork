package com.mcschool.flashcard.homeworks.dto;

import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkStats;
import com.mcschool.flashcard.homeworks.HomeworkStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

public record HomeworkResponse(
        UUID id,
        UUID studentId,
        LocalDate startDate,
        Instant createdAt,
        long totalCards,
        long notStarted,
        long inProgress,
        long learned,
        HomeworkStatus status,
        boolean hasWorksheet,
        String worksheetFilename,
        Integer worksheetPageCount,
        boolean submitted,
        Instant submittedAt
) {
    public static HomeworkResponse from(Homework homework, Map<UUID, HomeworkStats> statsByHomework) {
        HomeworkStats stats = statsByHomework.getOrDefault(homework.getId(),
                new HomeworkStats(homework.getId(), 0, 0, 0, 0));
        HomeworkStatus status = statusFor(homework, stats);
        return new HomeworkResponse(homework.getId(), homework.getStudent().getId(),
                homework.getStartDate(), homework.getCreatedAt(), stats.totalCards(),
                stats.notStarted(), stats.inProgress(), stats.learned(), status,
                homework.hasWorksheet(), homework.getWorksheetFilename(), homework.getWorksheetPageCount(),
                homework.isSubmitted(), homework.getSubmittedAt());
    }

    private static HomeworkStatus statusFor(Homework homework, HomeworkStats stats) {
        if (stats.totalCards() > 0 && stats.learned() == stats.totalCards()) {
            return HomeworkStatus.COMPLETED;
        }
        if (homework.getStartDate().isAfter(LocalDate.now())) {
            return HomeworkStatus.PENDING;
        }
        return HomeworkStatus.ACTIVE;
    }
}
