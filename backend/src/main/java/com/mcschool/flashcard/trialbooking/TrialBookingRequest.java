package com.mcschool.flashcard.trialbooking;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public record TrialBookingRequest(
        @NotNull UUID teacherId,
        @NotNull Instant startsAt,
        @NotBlank @Size(max = 100) String parentName,
        @NotBlank @Size(max = 100) String childName,
        @NotBlank @Size(max = 255) String contact,
        @NotBlank @Size(max = 80) String grade,
        @NotBlank @Size(max = 80) String schoolType,
        @NotBlank @Size(max = 80) String subject,
        @NotBlank @Size(max = 300) String goal,
        @NotBlank @Size(max = 200) String priority,
        @Size(max = 500) String source
) {}
