package com.mcschool.flashcard.liveclasses.dto;

import java.time.Instant;

/**
 * Everything the browser needs to connect, and nothing more: the public
 * {@code wss://} URL and a short-lived token scoped to one room and identity.
 */
public record OnlineClassConnectionResponse(
        String serverUrl,
        String token,
        String identity,
        String roomName,
        Instant expiresAt,
        boolean host,
        boolean recordingActive,
        boolean transcriptionActive
) {
}
