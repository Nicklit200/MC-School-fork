package com.mcschool.flashcard.monthlyplans.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateMonthlyPlanRequest(
        @NotBlank
        @Size(max = 100000)
        String planJson
) {
}
