package com.mcschool.flashcard.students.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateStudentNameRequest(
        @NotBlank @Size(max = 100) String fullName
) {}
