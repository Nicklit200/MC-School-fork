package com.mcschool.flashcard.groups.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record CreateGroupCardRequest(
        @NotNull LocalDate startDate,
        @NotBlank @Size(max = 1000) String question,
        @NotBlank @Size(max = 500) String correctAnswer
) {
}
