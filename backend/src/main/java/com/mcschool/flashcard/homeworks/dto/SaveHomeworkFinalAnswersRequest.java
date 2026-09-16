package com.mcschool.flashcard.homeworks.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SaveHomeworkFinalAnswersRequest(
        @NotEmpty @Size(max = 50) List<@Valid FinalAnswer> answers
) {
    public record FinalAnswer(
            @NotBlank @Size(max = 30) String label,
            @NotBlank @Size(max = 200) String answer
    ) {}
}
