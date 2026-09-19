package com.mcschool.flashcard.homeworks.dto;

import java.util.List;

public record HomeworkAnswerReviewResponse(
        int correctCount,
        int totalCount,
        double percent,
        List<Item> items
) {
    public record Item(String label, String answer, String correctAnswer, boolean correct) {
        @Override
        public String answer() {
            if (!correct && correctAnswer != null && !correctAnswer.isBlank()) {
                return this.answer + " → ✓ " + correctAnswer;
            }
            return this.answer;
        }
    }
}
