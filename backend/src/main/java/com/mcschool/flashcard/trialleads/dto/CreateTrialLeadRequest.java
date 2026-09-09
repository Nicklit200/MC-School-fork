package com.mcschool.flashcard.trialleads.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateTrialLeadRequest(
        @NotBlank @Size(max = 40) String phone,
        @Size(max = 500) String source
) {}
