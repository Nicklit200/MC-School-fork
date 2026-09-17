package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SchoolPromptSettingsService {

    private static final short SETTINGS_ID = 1;
    private static final int MAX_PROMPT_LENGTH = 30000;

    private final SchoolPromptSettingsRepository repository;

    public SchoolPromptSettingsService(SchoolPromptSettingsRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public SchoolPromptSettingsResponse readForStaff(AuthenticatedUser caller) {
        requireStaff(caller);
        return toResponse(requireSettings());
    }

    @Transactional
    public SchoolPromptSettingsResponse update(AuthenticatedUser caller,
                                               UpdateSchoolPromptSettingsRequest request) {
        if (caller == null || caller.role() != Role.ADMIN) {
            throw new IllegalArgumentException("Admin role required");
        }
        validate(request.groupLessonPrompt(), "Group lesson prompt");
        validate(request.individualLessonPrompt(), "Individual lesson prompt");
        SchoolPromptSettings settings = requireSettings();
        settings.updatePrompts(request.groupLessonPrompt(), request.individualLessonPrompt());
        return toResponse(repository.save(settings));
    }

    @Transactional(readOnly = true)
    public SchoolPromptSettingsResponse readForMcp() {
        return toResponse(requireSettings());
    }

    private SchoolPromptSettings requireSettings() {
        return repository.findById(SETTINGS_ID)
                .orElseThrow(() -> new IllegalStateException("School prompt settings are not initialized"));
    }

    private void requireStaff(AuthenticatedUser caller) {
        if (caller == null || (caller.role() != Role.ADMIN && caller.role() != Role.TEACHER)) {
            throw new IllegalArgumentException("Staff role required");
        }
    }

    private void validate(String value, String label) {
        if (value != null && value.length() > MAX_PROMPT_LENGTH) {
            throw new IllegalArgumentException(label + " is too long");
        }
    }

    private SchoolPromptSettingsResponse toResponse(SchoolPromptSettings settings) {
        return new SchoolPromptSettingsResponse(
                settings.getGroupLessonPrompt(),
                settings.getIndividualLessonPrompt(),
                settings.getUpdatedAt());
    }
}
