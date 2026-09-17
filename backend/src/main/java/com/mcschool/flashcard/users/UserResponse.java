package com.mcschool.flashcard.users;

import java.util.UUID;

/** Public representation of an account. Never exposes the password hash or invitation token. */
public record UserResponse(
        UUID id,
        String fullName,
        String email,
        String username,
        Role role,
        UserStatus status,
        Language preferredLanguage,
        String googleDriveTrialTranscriptFolderId
) {
    public static UserResponse from(User user) {
        return new UserResponse(user.getId(), user.getFullName(), user.getEmail(), user.getUsername(),
                user.getRole(), user.getStatus(), user.getPreferredLanguage(), user.getGoogleDriveTrialTranscriptFolderId());
    }
}
