package com.mcschool.flashcard.liveclasses.provider;

/**
 * Port for speech-to-text. The worker joins the room only while transcription is
 * running; no STT credential ever reaches the browser.
 *
 * <p>A provider failure must degrade transcription only — it must never end the
 * class or interrupt media.
 */
public interface ClassTranscriptionProvider {

    boolean isConfigured();

    /**
     * Asks the worker to join and begin transcribing.
     *
     * @param languageHints BCP-47 hints (e.g. "ru", "de"); may be empty for
     *                      auto-detection
     * @return an opaque session id used to stop the same run
     */
    String startTranscription(String roomName, String classId, java.util.List<String> languageHints);

    /**
     * Stops a run. Safe if it already stopped.
     *
     * <p>Takes the room as well as the session id because the provider addresses
     * a dispatch by (room, id) — the id alone does not identify it.
     */
    void stopTranscription(String roomName, String sessionId);
}
