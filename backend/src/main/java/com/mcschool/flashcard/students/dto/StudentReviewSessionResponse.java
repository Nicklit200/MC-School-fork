package com.mcschool.flashcard.students.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record StudentReviewSessionResponse(
        UUID sessionId,
        Instant completedAt,
        int totalCards,
        int correctAnswers,
        int wrongAnswers,
        List<StudentReviewAnswerResponse> answers
) {
}
