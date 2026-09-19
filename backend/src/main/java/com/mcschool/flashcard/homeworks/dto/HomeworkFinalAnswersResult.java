package com.mcschool.flashcard.homeworks.dto;

import java.util.List;

public record HomeworkFinalAnswersResult(
        int correctCount,
        int totalCount,
        boolean allCorrect,
        List<Item> items
) {
    public record Item(String label, boolean correct) {}
}
