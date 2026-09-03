package com.mcschool.flashcard.students.dto;

import com.mcschool.flashcard.users.Language;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserStatus;
import java.util.UUID;

/**
 * Teacher-owned student row. Includes the invitation token only while the
 * student is still invited so the owning teacher can copy an activation link.
 */
public record StudentListResponse(
        UUID id,
        String fullName,
        String email,
        Role role,
        UserStatus status,
        Language preferredLanguage,
        String invitationToken,
        String googleDriveFolderUrl,
        String googleDriveHomeworkFolderId
) {
    public static StudentListResponse from(User student) {
        return new StudentListResponse(student.getId(), student.getFullName(), student.getEmail(),
                student.getRole(), student.getStatus(), student.getPreferredLanguage(),
                student.getStatus() == UserStatus.INVITED ? student.getInvitationToken() : null,
                student.getGoogleDriveFolderUrl(), student.getGoogleDriveHomeworkFolderId());
    }
}
