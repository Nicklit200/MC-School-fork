package com.mcschool.flashcard.students.dto;

public record UpdateStudentLearningProfileRequest(
        Integer grade,
        String schoolType,
        String learningPace,
        String learningStrengths,
        String learningDifficulties,
        String explanationStyle,
        String learningNotes
) {}
