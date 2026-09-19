package com.mcschool.flashcard.liveclasses.provider;

/** Used when recording is disabled or storage is missing. */
public class UnconfiguredRecordingProvider implements ClassRecordingProvider {

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public String startRoomRecording(String roomName, String objectKey) {
        throw new MediaProviderException("Recording is not configured");
    }

    /** Stopping something that never started is a no-op. */
    @Override
    public void stopRecording(String egressId) {
        // no-op
    }
}
