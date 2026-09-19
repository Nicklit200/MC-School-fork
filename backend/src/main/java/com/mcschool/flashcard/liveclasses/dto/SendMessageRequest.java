package com.mcschool.flashcard.liveclasses.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * @param clientMessageId caller-generated idempotency key; a retry with the same
 *                        value returns the original message instead of a duplicate
 */
public record SendMessageRequest(
        @NotNull UUID clientMessageId,
        @NotBlank @Size(max = 2000) String body
) {
}
