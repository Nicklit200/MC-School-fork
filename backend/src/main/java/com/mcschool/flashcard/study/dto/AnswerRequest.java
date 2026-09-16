package com.mcschool.flashcard.study.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * The student's chosen option for a card. {@code selectedAnswer} is the option text.
 * When {@code timedOut} is true the per-card time limit expired before the student
 * answered, so the card is scored as incorrect and {@code selectedAnswer} may be blank.
 */
public record AnswerRequest(
        @NotNull UUID cardId,
        @Size(max = 500) String selectedAnswer,
        Boolean timedOut
) {
}
