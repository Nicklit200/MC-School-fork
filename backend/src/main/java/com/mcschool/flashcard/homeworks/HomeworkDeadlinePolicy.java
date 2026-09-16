package com.mcschool.flashcard.homeworks;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/** Shared homework lateness rules for students, teachers and parents. */
public final class HomeworkDeadlinePolicy {

    public static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");

    private HomeworkDeadlinePolicy() {}

    /**
     * A homework assigned for a date can be submitted normally during that entire day.
     * It becomes overdue only when the next calendar day begins in Berlin.
     */
    public static Instant deadlineAt(LocalDate startDate) {
        return startDate.plusDays(1).atStartOfDay(SCHOOL_ZONE).toInstant();
    }

    public static boolean isOverdue(Homework homework) {
        return !homework.isSubmitted() && !Instant.now().isBefore(deadlineAt(homework.getStartDate()));
    }

    public static boolean wasSubmittedLate(Homework homework) {
        return homework.isSubmitted()
                && homework.getSubmittedAt() != null
                && !homework.getSubmittedAt().isBefore(deadlineAt(homework.getStartDate()));
    }
}
