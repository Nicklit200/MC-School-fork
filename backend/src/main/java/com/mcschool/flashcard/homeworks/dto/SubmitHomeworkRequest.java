package com.mcschool.flashcard.homeworks.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record SubmitHomeworkRequest(
        @NotEmpty List<@Valid HomeworkPageOverlayRequest> overlays
) {
}
