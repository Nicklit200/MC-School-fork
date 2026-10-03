package com.mcschool.flashcard.settings;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateSchoolPromptSettingsRequest(
        @NotNull @Size(max = 30000) String groupLessonPrompt,
        @NotNull @Size(max = 30000) String individualLessonPrompt,
        @NotNull @Size(max = 30000) String diagnosticLessonPrompt,
        @Size(max = 30000) String errorCorrectionPrompt,
        @Size(max = 30000) String workbookPrompt,
        @Size(max = 30000) String homeworkPrompt
) {
}
