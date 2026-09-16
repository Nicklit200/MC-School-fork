package com.mcschool.flashcard.cards.dto;

import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardStatus;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A card as returned to teachers and to the owning student. Includes the correct
 * answer (it is study material the student is allowed to see outside a session)
 * but never exposes distractors, which are generated per question at study time.
 */
public record CardResponse(
        UUID id,
        UUID homeworkId,
        String question,
        String correctAnswer,
        CardStatus status,
        int repetitionNumber,
        LocalDate dueDate,
        Integer timeLimitSeconds
) {
    public static CardResponse from(Card card) {
        return new CardResponse(card.getId(), card.getHomework().getId(), card.getQuestion(), card.getCorrectAnswer(),
                card.getStatus(), card.getRepetitionNumber(), card.getDueDate(), card.getTimeLimitSeconds());
    }
}
