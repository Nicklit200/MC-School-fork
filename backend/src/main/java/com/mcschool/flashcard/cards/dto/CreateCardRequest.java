package com.mcschool.flashcard.cards.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Manual card creation: the teacher enters the question and the correct answer,
 * and may optionally set a per-card answer time limit (1–3600 seconds; omit for none).
 */
public record CreateCardRequest(
        @NotBlank @Size(max = 1000) String question,
        @NotBlank @Size(max = 500) String correctAnswer,
        @Min(1) @Max(3600) Integer timeLimitSeconds
) {
}
