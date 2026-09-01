package com.mcschool.flashcard.students.dto;

import jakarta.validation.constraints.Size;

public record UpdateStudentDriveFolderRequest(
        @Size(max = 1000) String googleDriveFolderUrl
) {
}
