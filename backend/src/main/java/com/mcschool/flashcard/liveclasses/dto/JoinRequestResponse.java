package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.JoinRequestState;
import com.mcschool.flashcard.liveclasses.OnlineClassJoinRequest;
import java.time.Instant;
import java.util.UUID;

/** A waiting-room entry as shown to the teacher. */
public record JoinRequestResponse(
        UUID id,
        UUID userId,
        String displayName,
        JoinRequestState state,
        Instant requestedAt,
        Instant decidedAt
) {

    public static JoinRequestResponse from(OnlineClassJoinRequest source) {
        return new JoinRequestResponse(
                source.getId(),
                source.getUser().getId(),
                source.getUser().getFullName(),
                source.getState(),
                source.getRequestedAt(),
                source.getDecidedAt());
    }
}
