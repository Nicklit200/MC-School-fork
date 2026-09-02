package com.mcschool.flashcard.homeworks.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record HomeworkPageOverlayRequest(
        @Min(0) int pageIndex,
        @NotBlank String imageBase64
) {
}
