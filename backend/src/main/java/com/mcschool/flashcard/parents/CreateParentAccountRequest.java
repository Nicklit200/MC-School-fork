package com.mcschool.flashcard.parents;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateParentAccountRequest(
        @NotBlank @Size(max = 100) String fullName
) {}
