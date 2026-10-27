package com.mcschool.flashcard.users.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record TransferStudentsRequest(
        @NotNull UUID fromTeacherId,
        @NotNull UUID toTeacherId
) {}
