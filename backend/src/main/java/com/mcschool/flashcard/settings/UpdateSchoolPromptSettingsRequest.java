package com.mcschool.flashcard.settings;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateSchoolPromptSettingsRequest(
        @NotNull @Size(max = 30000) String groupLessonPrompt,
        @NotNull @Size(max = 30000) String individualLessonPrompt
) {
}
