package com.mcschool.flashcard.groups.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public record CreateStudentGroupRequest(
        @NotBlank @Size(max = 120) String name,
        @JsonAlias("emails") @NotEmpty List<@NotNull UUID> studentIds
) {
}
