package com.mcschool.flashcard.liveclasses.provider;

import java.util.List;

/** Used when transcription is disabled or unconfigured. */
public class UnconfiguredTranscriptionProvider implements ClassTranscriptionProvider {

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public String startTranscription(String roomName, String classId, List<String> languageHints) {
        throw new MediaProviderException("Transcription is not configured");
    }

    /** Stopping something that never started is a no-op. */
    @Override
    public void stopTranscription(String roomName, String sessionId) {
        // no-op
    }
}
