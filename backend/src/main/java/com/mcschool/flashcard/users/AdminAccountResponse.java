package com.mcschool.flashcard.users;

import java.util.UUID;

/** Admin account row with the currently assigned teacher, if any. */
public record AdminAccountResponse(
        UUID id,
        String fullName,
        String email,
        String username,
        Role role,
        UserStatus status,
        Language preferredLanguage,
        String googleDriveTrialTranscriptFolderId,
        UUID teacherId,
        String teacherFullName
) {
    public static AdminAccountResponse from(User user) {
        User teacher = user.getTeacher();
        return new AdminAccountResponse(
                user.getId(),
                user.getFullName(),
                user.getEmail(),
                user.getUsername(),
                user.getRole(),
                user.getStatus(),
                user.getPreferredLanguage(),
                user.getGoogleDriveTrialTranscriptFolderId(),
                teacher == null ? null : teacher.getId(),
                teacher == null ? null : teacher.getFullName()
        );
    }
}
