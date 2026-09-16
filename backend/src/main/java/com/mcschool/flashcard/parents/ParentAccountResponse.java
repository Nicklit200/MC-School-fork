package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.users.UserStatus;
import java.util.List;
import java.util.UUID;

public record ParentAccountResponse(
        UUID id,
        String fullName,
        String username,
        String email,
        UserStatus status,
        List<Child> children
) {
    public record Child(UUID id, String fullName) {}
}
