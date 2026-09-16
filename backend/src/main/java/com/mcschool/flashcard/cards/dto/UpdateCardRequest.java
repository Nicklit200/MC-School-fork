package com.mcschool.flashcard.cards.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Edit a card. {@code timeLimitSeconds} sets the per-card answer time limit
 * (1–3600 seconds); send {@code null} to remove the limit.
 */
public record UpdateCardRequest(
        @NotBlank @Size(max = 1000) String question,
        @NotBlank @Size(max = 500) String correctAnswer,
        @Min(1) @Max(3600) Integer timeLimitSeconds
) {
}
