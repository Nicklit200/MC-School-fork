package com.mcschool.flashcard.students.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdateStudentHomeworkDriveFolderRequest(
        @Size(max = 1000)
        @Pattern(regexp = "^\\s*$|^[A-Za-z0-9_-]+$",
                 message = "Must be a Google Drive folder id")
        String googleDriveHomeworkFolderId
) {
}
