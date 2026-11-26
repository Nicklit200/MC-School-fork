package com.mcschool.flashcard.students.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateStudentUsernameRequest(
        @NotBlank @Size(max = 60) String username
) {}
