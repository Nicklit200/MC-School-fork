package com.mcschool.flashcard.students.dto;

import java.util.UUID;

public record StudentReviewAnswerResponse(
        UUID cardId,
        String question,
        String selectedAnswer,
        String correctAnswer,
        boolean correct
) {
}
