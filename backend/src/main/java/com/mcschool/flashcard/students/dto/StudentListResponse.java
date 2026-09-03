package com.mcschool.flashcard.students.dto;

import com.mcschool.flashcard.users.Language;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserStatus;
import java.util.UUID;

/** Teacher-owned student row, including optional linked parent account. */
public record StudentListResponse(
        UUID id,
        String fullName,
        String email,
        Role role,
        UserStatus status,
        Language preferredLanguage,
        String invitationToken,
        String googleDriveFolderUrl,
        String googleDriveHomeworkFolderId,
        UUID parentId,
        String parentFullName,
        String parentEmail,
        UserStatus parentStatus,
        String parentInvitationToken
) {
    public static StudentListResponse from(User student) {
        User parent = student.getParent();
        return new StudentListResponse(
                student.getId(),
                student.getFullName(),
                student.getEmail(),
                student.getRole(),
                student.getStatus(),
                student.getPreferredLanguage(),
                student.getStatus() == UserStatus.INVITED ? student.getInvitationToken() : null,
                student.getGoogleDriveFolderUrl(),
                student.getGoogleDriveHomeworkFolderId(),
                parent == null ? null : parent.getId(),
                parent == null ? null : parent.getFullName(),
                parent == null ? null : parent.getEmail(),
                parent == null ? null : parent.getStatus(),
                parent != null && parent.getStatus() == UserStatus.INVITED ? parent.getInvitationToken() : null
        );
    }
}
