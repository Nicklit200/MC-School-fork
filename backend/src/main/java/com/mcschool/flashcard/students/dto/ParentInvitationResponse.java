package com.mcschool.flashcard.students.dto;

import com.mcschool.flashcard.users.UserResponse;
import java.time.Instant;

public record ParentInvitationResponse(
        UserResponse parent,
        String invitationToken,
        Instant invitationExpiresAt
) {}
