package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Reports online-class integration status <strong>without ever reporting
 * DOWN</strong>.
 *
 * <p>This is deliberate. Online classes are an optional feature layered onto the
 * flashcard application; if LiveKit, object storage or the STT provider were
 * allowed to fail the health check, an outage in an optional integration would
 * cause an orchestrator to kill or refuse traffic to the <em>entire</em>
 * application — including flashcards, homework and parent access, none of which
 * depend on it.
 *
 * <p>Status therefore belongs in the details, where a human or a dashboard can
 * read it, not in the aggregate health verdict. Details are only rendered when
 * an operator explicitly enables {@code show-details}; the endpoint is
 * unauthenticated, so the defaults keep configuration state private.
 */
@Component("onlineClassIntegrations")
public class OnlineClassIntegrationsHealth implements HealthIndicator {

    private final OnlineClassProperties properties;
    private final LiveClassMediaProvider mediaProvider;
    private final ClassRecordingProvider recordingProvider;
    private final ClassTranscriptionProvider transcriptionProvider;
    private final ClassArtifactStorage storage;

    public OnlineClassIntegrationsHealth(OnlineClassProperties properties,
                                         LiveClassMediaProvider mediaProvider,
                                         ClassRecordingProvider recordingProvider,
                                         ClassTranscriptionProvider transcriptionProvider,
                                         ClassArtifactStorage storage) {
        this.properties = properties;
        this.mediaProvider = mediaProvider;
        this.recordingProvider = recordingProvider;
        this.transcriptionProvider = transcriptionProvider;
        this.storage = storage;
    }

    @Override
    public Health health() {
        // Always UP: see the class comment. Booleans only — never a URL, key
        // fragment or bucket name.
        return Health.up()
                .withDetail("feature", properties.enabled() ? "enabled" : "disabled")
                .withDetail("media", mediaProvider.isConfigured())
                .withDetail("storage", storage.isConfigured())
                .withDetail("recording", recordingProvider.isConfigured())
                .withDetail("transcription", transcriptionProvider.isConfigured())
                .build();
    }
}
