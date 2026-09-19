package com.mcschool.flashcard.liveclasses.provider.livekit;

import com.mcschool.flashcard.liveclasses.OnlineClassProperties;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import io.livekit.server.AgentDispatchServiceClient;
import java.util.List;
import java.util.stream.Collectors;
import livekit.LivekitAgentDispatch;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import retrofit2.Call;
import retrofit2.Response;

/**
 * Dispatches the transcription agent into a room on demand.
 *
 * <p>Explicit dispatch is what makes "the worker joins only when transcription
 * is started" true: the agent registers with LiveKit under a name but sits idle
 * until a dispatch names it for a room.
 *
 * <p>No STT credential passes through here — the agent holds its own.
 */
public class LiveKitAgentTranscriptionProvider implements ClassTranscriptionProvider {

    private static final Logger log =
            LoggerFactory.getLogger(LiveKitAgentTranscriptionProvider.class);

    private final OnlineClassProperties properties;
    private final String agentName;
    private final AgentDispatchServiceClient dispatchClient;

    public LiveKitAgentTranscriptionProvider(OnlineClassProperties properties, String agentName) {
        this.properties = properties;
        this.agentName = agentName;
        this.dispatchClient = AgentDispatchServiceClient.createClient(
                LiveKitMediaProvider.toHttpUrl(properties.livekitUrl()),
                properties.livekitApiKey(),
                properties.livekitApiSecret());
    }

    @Override
    public boolean isConfigured() {
        return properties.isTranscriptionAvailable() && agentName != null && !agentName.isBlank();
    }

    @Override
    public String startTranscription(String roomName, String classId, List<String> languageHints) {
        // The agent needs the class id to address its ingestion calls, and the
        // language hints to configure the STT session. Metadata is the only
        // channel for that at dispatch time.
        String metadata = "{\"classId\":\"" + classId + "\",\"languages\":["
                + languageHints.stream()
                        .map(hint -> "\"" + hint.replaceAll("[^A-Za-z-]", "") + "\"")
                        .collect(Collectors.joining(","))
                + "]}";

        LivekitAgentDispatch.AgentDispatch dispatch =
                execute(dispatchClient.createDispatch(roomName, agentName, metadata, null, null));
        if (dispatch == null) {
            throw new MediaProviderException("Transcription agent could not be dispatched");
        }
        log.info("Transcription agent dispatched: dispatchId={}", dispatch.getId());
        return dispatch.getId();
    }

    @Override
    public void stopTranscription(String roomName, String sessionId) {
        try {
            execute(dispatchClient.deleteDispatch(roomName, sessionId));
        } catch (MediaProviderException e) {
            // Already gone, or the room ended first: not an error.
            log.debug("Transcription dispatch was already stopped");
        }
    }

    private static <T> T execute(Call<T> call) {
        try {
            Response<T> response = call.execute();
            if (!response.isSuccessful()) {
                throw new MediaProviderException(
                        "LiveKit agent dispatch failed with HTTP " + response.code());
            }
            return response.body();
        } catch (java.io.IOException e) {
            throw new MediaProviderException("LiveKit agent dispatch failed", e);
        }
    }
}
