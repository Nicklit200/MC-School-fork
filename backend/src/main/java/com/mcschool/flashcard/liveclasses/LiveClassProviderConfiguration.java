package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.UnconfiguredTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.UnconfiguredArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.UnconfiguredRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.UnconfiguredMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.livekit.LiveKitMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.livekit.LiveKitAgentTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.livekit.LiveKitRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.s3.S3ClassArtifactStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Selects the realtime media implementation.
 *
 * <p>Fails safe: when the feature is off or credentials are absent the
 * application still starts normally with an unconfigured provider, so an
 * optional integration outage can never take down the flashcard application.
 */
@Configuration
public class LiveClassProviderConfiguration {

    private static final Logger log = LoggerFactory.getLogger(LiveClassProviderConfiguration.class);

    /**
     * System clock, injected rather than called statically so time-window rules
     * are testable. Guarded so a test can supply a fixed clock.
     */
    @Bean
    @ConditionalOnMissingBean(java.time.Clock.class)
    public java.time.Clock clock() {
        return java.time.Clock.systemUTC();
    }

    @Bean
    @ConditionalOnMissingBean(LiveClassMediaProvider.class)
    public LiveClassMediaProvider liveClassMediaProvider(OnlineClassProperties properties) {
        if (!properties.isMediaConfigured()) {
            // Never log which value is missing: that is a configuration oracle.
            log.info("Online classes: media provider unconfigured (enabled={})", properties.enabled());
            return new UnconfiguredMediaProvider();
        }
        log.info("Online classes: LiveKit media provider active");
        return new LiveKitMediaProvider(properties);
    }

    /**
     * Object storage. Absent credentials yield an unconfigured adapter so the
     * application still starts and recording simply reports unavailable.
     */
    @Bean
    @ConditionalOnMissingBean(ClassArtifactStorage.class)
    public ClassArtifactStorage classArtifactStorage(ClassStorageProperties properties) {
        if (!properties.isConfigured()) {
            log.info("Online classes: artifact storage unconfigured");
            return new UnconfiguredArtifactStorage();
        }
        log.info("Online classes: S3-compatible artifact storage active");
        return new S3ClassArtifactStorage(properties);
    }

    /** Recording needs both the provider and storage; either missing disables it. */
    @Bean
    @ConditionalOnMissingBean(ClassRecordingProvider.class)
    public ClassRecordingProvider classRecordingProvider(OnlineClassProperties properties,
                                                         ClassStorageProperties storageProperties) {
        if (!properties.isRecordingAvailable() || !storageProperties.isConfigured()) {
            log.info("Online classes: recording unavailable (recordingEnabled={})",
                    properties.recordingEnabled());
            return new UnconfiguredRecordingProvider();
        }
        log.info("Online classes: LiveKit Egress recording active");
        return new LiveKitRecordingProvider(properties, storageProperties);
    }

    /**
     * Transcription. The agent registers with LiveKit under a name and stays
     * idle until dispatched, so the worker joins only when a teacher starts it.
     */
    @Bean
    @ConditionalOnMissingBean(ClassTranscriptionProvider.class)
    public ClassTranscriptionProvider classTranscriptionProvider(OnlineClassProperties properties) {
        if (!properties.isTranscriptionAvailable()
                || properties.transcriptionAgentName() == null
                || properties.transcriptionAgentName().isBlank()) {
            log.info("Online classes: transcription unavailable (transcriptionEnabled={})",
                    properties.transcriptionEnabled());
            return new UnconfiguredTranscriptionProvider();
        }
        log.info("Online classes: LiveKit agent transcription active");
        return new LiveKitAgentTranscriptionProvider(properties, properties.transcriptionAgentName());
    }
}
