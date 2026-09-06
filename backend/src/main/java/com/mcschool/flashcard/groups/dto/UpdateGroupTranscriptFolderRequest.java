package com.mcschool.flashcard.groups.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateGroupTranscriptFolderRequest(
        @NotBlank @Size(max = 255) String folderId
) {}
