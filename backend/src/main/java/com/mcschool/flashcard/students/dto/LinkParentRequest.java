package com.mcschool.flashcard.students.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LinkParentRequest(
        @NotBlank @Size(max = 100) String fullName,
        @NotBlank @Email @Size(max = 255) String email
) {}
