package com.mcschool.flashcard.users;

import java.util.UUID;

public record TeacherAssignmentOption(
        UUID id,
        String fullName,
        UserStatus status,
        boolean archived
) {
    public static TeacherAssignmentOption from(User user) {
        return new TeacherAssignmentOption(user.getId(), user.getFullName(), user.getStatus(), user.isArchived());
    }
}
