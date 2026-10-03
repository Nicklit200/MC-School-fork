package com.mcschool.flashcard.settings;

import java.time.Instant;

public record SchoolPromptSettingsResponse(
        String groupLessonPrompt,
        String individualLessonPrompt,
        String diagnosticLessonPrompt,
        String errorCorrectionPrompt,
        Instant updatedAt
) {
}
