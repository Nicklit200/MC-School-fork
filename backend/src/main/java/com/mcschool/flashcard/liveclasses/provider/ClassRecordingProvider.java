package com.mcschool.flashcard.liveclasses.provider;

/**
 * Port for server-side recording (LiveKit Egress), kept separate from
 * {@link LiveClassMediaProvider} because recording is an independently
 * configured and independently failing concern.
 *
 * <p>Completion is never inferred from the start call: it arrives asynchronously
 * via a signature-verified webhook.
 */
public interface ClassRecordingProvider {

    boolean isConfigured();

    /**
     * Starts a room-composite recording writing to object storage.
     *
     * @return the provider egress id used to correlate later webhooks
     */
    String startRoomRecording(String roomName, String objectKey);

    /** Stops a recording. Safe to call if it already stopped. */
    void stopRecording(String egressId);
}
