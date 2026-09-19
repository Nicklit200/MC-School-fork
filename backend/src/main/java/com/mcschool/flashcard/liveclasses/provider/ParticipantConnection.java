package com.mcschool.flashcard.liveclasses.provider;

import java.time.Instant;

/**
 * Everything the browser is allowed to know in order to connect.
 *
 * <p>Contains a short-lived token scoped to one room and one identity — never
 * the API secret, and never an unrestricted admin token.
 */
public record ParticipantConnection(
        String serverUrl,
        String token,
        String identity,
        String roomName,
        Instant expiresAt
) {
}
