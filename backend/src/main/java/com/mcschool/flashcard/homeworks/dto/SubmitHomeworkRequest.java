package com.mcschool.flashcard.homeworks.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record SubmitHomeworkRequest(
        @NotNull List<@Valid HomeworkPageOverlayRequest> overlays
) {
}
