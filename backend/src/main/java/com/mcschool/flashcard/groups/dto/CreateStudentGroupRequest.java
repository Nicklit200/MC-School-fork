package com.mcschool.flashcard.groups.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateStudentGroupRequest(
        @NotBlank @Size(max = 120) String name,
        @NotEmpty List<@NotBlank @Email String> emails
) {
}
