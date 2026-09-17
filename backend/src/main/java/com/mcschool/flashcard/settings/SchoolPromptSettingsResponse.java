package com.mcschool.flashcard.settings;

import java.time.Instant;

public record SchoolPromptSettingsResponse(
        String groupLessonPrompt,
        String individualLessonPrompt,
        Instant updatedAt
) {
}
