package com.mcschool.flashcard.study.dto;

import java.util.List;
import java.util.UUID;

/**
 * The current question in a session: the card's question and the four shuffled
 * answer options. {@code answeredCount}/{@code totalCards} feed the progress bar.
 * The correct answer is not marked here — it is revealed only after the student answers.
 */
public record QuestionResponse(
        UUID cardId,
        String question,
        List<String> options,
        int answeredCount,
        int totalCards,
        Integer timeLimitSeconds
) {
}
