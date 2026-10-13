package com.mcschool.flashcard.liveclasses.provider;

import java.time.Duration;
import java.util.List;

/**
 * Used when online classes are disabled or LiveKit is not configured.
 *
 * <p>Fails loudly and specifically rather than half-working, so the teacher-facing
 * UI can show a precise "unavailable" state. Messages never reveal which secret
 * is missing.
 */
public class UnconfiguredMediaProvider implements LiveClassMediaProvider {

    private static final String MESSAGE = "Online classes are not configured on this server";

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public ParticipantConnection createConnection(String roomName, String identity, String displayName,
                                                  MediaGrant grant, Duration ttl) {
        throw new MediaProviderException(MESSAGE);
    }

    @Override
    public void ensureRoom(String roomName) {
        throw new MediaProviderException(MESSAGE);
    }

    /** Closing a room that can never have opened is a no-op, not an error. */
    @Override
    public void closeRoom(String roomName) {
        // no-op
    }

    @Override
    public void muteParticipantAudio(String roomName, String identity) {
        throw new MediaProviderException(MESSAGE);
    }

    @Override
    public void removeParticipant(String roomName, String identity) {
        throw new MediaProviderException(MESSAGE);
    }

    @Override
    public void updatePublishPermissions(String roomName, String identity, MediaGrant grant) {
        throw new MediaProviderException(MESSAGE);
    }

    @Override
    public List<String> listParticipantIdentities(String roomName) {
        return List.of();
    }

    @Override
    public void sendControlPacket(String roomName, String topic, byte[] payload) {
        throw new MediaProviderException(MESSAGE);
    }
}
