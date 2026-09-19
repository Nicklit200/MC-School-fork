package com.mcschool.flashcard.liveclasses;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration for the online-class feature.
 *
 * <p>Fails safe: with {@code enabled=false} the existing Google Meet / Soniox
 * flow continues to work untouched. Sub-features report themselves unavailable
 * rather than half-working when their credentials are absent.
 *
 * <p>Secrets here are server-side only and must never be serialized into an API
 * response or a log line.
 */
@ConfigurationProperties(prefix = "app.online-classes")
public record OnlineClassProperties(
        boolean enabled,
        String livekitUrl,
        String livekitApiKey,
        String livekitApiSecret,
        boolean recordingEnabled,
        boolean transcriptionEnabled,
        Duration joinWindowBeforeStart,
        Duration joinWindowAfterEnd,
        Duration tokenTtl,
        String transcriptionAgentName,
        String transcriptionInternalToken,
        /** Dev/QA only: allows creating a class without Google Calendar. */
        boolean allowTestClasses
) {

    public OnlineClassProperties {
        joinWindowBeforeStart = joinWindowBeforeStart == null ? Duration.ofMinutes(15) : joinWindowBeforeStart;
        joinWindowAfterEnd = joinWindowAfterEnd == null ? Duration.ofMinutes(60) : joinWindowAfterEnd;
        tokenTtl = tokenTtl == null ? Duration.ofMinutes(10) : tokenTtl;
    }

    /**
     * True when the realtime provider has everything it needs. Checked before
     * offering the teacher a "Start online class" action.
     */
    public boolean isMediaConfigured() {
        return enabled
                && hasText(livekitUrl)
                && hasText(livekitApiKey)
                && hasText(livekitApiSecret);
    }

    /** Recording additionally requires object storage, validated separately. */
    public boolean isRecordingAvailable() {
        return isMediaConfigured() && recordingEnabled;
    }

    public boolean isTranscriptionAvailable() {
        return isMediaConfigured() && transcriptionEnabled;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
