package com.mcschool.flashcard.liveclasses.provider;

import java.time.Duration;
import java.util.List;

/**
 * Port for realtime media. The LiveKit implementation lives behind this so no
 * provider-specific token signing or API call leaks into controllers/services.
 *
 * <p>Implementations must be safe to call repeatedly: every operation here is
 * invoked from idempotent application-level lifecycle operations.
 */
public interface LiveClassMediaProvider {

    /** Whether the provider is configured well enough to be used at all. */
    boolean isConfigured();

    /**
     * Mints a connection scoped to one room and one identity.
     *
     * @param identity must be unique per user+device and must embed the
     *                 application user id so webhooks can be attributed
     * @param ttl      kept short (minutes); clients reconnect to refresh
     */
    ParticipantConnection createConnection(String roomName, String identity, String displayName,
                                           MediaGrant grant, Duration ttl);

    /** Creates the room if absent. Safe to call on every start. */
    void ensureRoom(String roomName);

    /** Removes the room and disconnects everyone. Safe if already gone. */
    void closeRoom(String roomName);

    /** Server-side mute of a participant's published audio. */
    void muteParticipantAudio(String roomName, String identity);

    /** Disconnects a participant; they must not receive a new token afterwards. */
    void removeParticipant(String roomName, String identity);

    /** Updates what a participant may publish, without reconnecting them. */
    void updatePublishPermissions(String roomName, String identity, MediaGrant grant);

    /** Identities currently connected, used to reconcile attendance. */
    List<String> listParticipantIdentities(String roomName);

    /**
     * Sends a server-authored data packet to the room (control notifications).
     *
     * @param topic versioned topic name, e.g. {@code mc.class.control.v1}
     */
    void sendControlPacket(String roomName, String topic, byte[] payload);
}
