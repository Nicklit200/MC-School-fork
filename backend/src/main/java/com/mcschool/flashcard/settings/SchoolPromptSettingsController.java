package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/school-prompts")
public class SchoolPromptSettingsController {

    private final SchoolPromptSettingsService service;

    public SchoolPromptSettingsController(SchoolPromptSettingsService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public SchoolPromptSettingsResponse get(@AuthenticationPrincipal AuthenticatedUser caller) {
        return service.readForStaff(caller);
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public SchoolPromptSettingsResponse update(@AuthenticationPrincipal AuthenticatedUser caller,
                                               @Valid @RequestBody UpdateSchoolPromptSettingsRequest request) {
        return service.update(caller, request);
    }
}
