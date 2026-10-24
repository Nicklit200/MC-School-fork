package com.mcschool.flashcard.lessons.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public record CreateLessonRequest(
        @NotBlank @Size(max = 500) String title,
        @NotNull Instant startsAt,
        @NotNull Instant endsAt,
        UUID groupId,
        UUID studentId
) {
    @AssertTrue(message = "Lesson end must be after its start")
    public boolean isTimeRangeValid() {
        return startsAt == null || endsAt == null || endsAt.isAfter(startsAt);
    }

    @AssertTrue(message = "Choose a group or a student, not both")
    public boolean isTargetValid() {
        return groupId == null || studentId == null;
    }
}
