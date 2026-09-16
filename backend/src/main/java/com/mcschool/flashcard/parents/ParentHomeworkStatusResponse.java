package com.mcschool.flashcard.parents;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record ParentHomeworkStatusResponse(
        UUID homeworkId,
        LocalDate startDate,
        String filename,
        boolean submitted,
        Instant submittedAt,
        Instant deadlineAt,
        boolean overdue,
        boolean submittedLate
) {}
