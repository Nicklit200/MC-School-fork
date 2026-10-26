package com.mcschool.flashcard.lessons.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

public record CreateLessonSeriesRequest(
        @NotBlank @Size(max = 500) String title,
        @NotNull LocalDate startDate,
        @NotNull @Min(1) @Max(1440) Integer durationMinutes,
        @NotNull Period period,
        @NotEmpty Set<@NotNull @Min(1) @Max(7) Integer> weekdays,
        UUID groupId,
        UUID studentId,
        LocalTime startTime
) {
    public CreateLessonSeriesRequest(String title, LocalDate startDate, Integer durationMinutes, Period period, Set<Integer> weekdays, UUID groupId, UUID studentId) {
        this(title, startDate, durationMinutes, period, weekdays, groupId, studentId, LocalTime.MIDNIGHT);
    }

    public enum Period { TWO_WEEKS, THREE_WEEKS, MONTH }

    @AssertTrue(message = "Choose a group or a student, not both")
    public boolean isTargetValid() { return groupId == null || studentId == null; }
}
