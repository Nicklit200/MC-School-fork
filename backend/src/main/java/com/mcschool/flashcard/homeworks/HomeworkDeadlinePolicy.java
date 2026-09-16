package com.mcschool.flashcard.homeworks;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

/** Shared homework deadline rules for students, teachers and parents. */
public final class HomeworkDeadlinePolicy {

    public static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    public static final LocalTime DEADLINE_TIME = LocalTime.of(19, 0);

    private HomeworkDeadlinePolicy() {}

    public static Instant deadlineAt(LocalDate startDate) {
        return startDate.atTime(DEADLINE_TIME).atZone(SCHOOL_ZONE).toInstant();
    }

    public static boolean isOverdue(Homework homework) {
        return !homework.isSubmitted() && Instant.now().isAfter(deadlineAt(homework.getStartDate()));
    }

    public static boolean wasSubmittedLate(Homework homework) {
        return homework.isSubmitted()
                && homework.getSubmittedAt() != null
                && homework.getSubmittedAt().isAfter(deadlineAt(homework.getStartDate()));
    }
}
