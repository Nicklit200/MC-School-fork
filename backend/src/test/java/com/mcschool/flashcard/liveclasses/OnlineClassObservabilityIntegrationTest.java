package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Status;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Health and metrics behaviour.
 *
 * <p>The load-bearing assertion here is that an optional-integration outage does
 * not make the application unhealthy: doing so would let a LiveKit or S3 problem
 * take down flashcards, homework and parent access, none of which depend on it.
 */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class OnlineClassObservabilityIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private OnlineClassIntegrationsHealth health;

    @Autowired
    private OnlineClassMetrics metrics;

    @Autowired
    private MeterRegistry registry;

    @MockitoBean
    private LiveClassMediaProvider mediaProvider;

    @MockitoBean
    private ClassRecordingProvider recordingProvider;

    @MockitoBean
    private ClassTranscriptionProvider transcriptionProvider;

    @MockitoBean
    private ClassArtifactStorage storage;

    @Test
    void healthStaysUpWhenEveryOptionalIntegrationIsDown() {
        // All providers report unconfigured (mock default is false).
        var result = health.health();

        assertThat(result.getStatus()).isEqualTo(Status.UP);
        assertThat(result.getDetails()).containsEntry("media", false);
        assertThat(result.getDetails()).containsEntry("storage", false);
        assertThat(result.getDetails()).containsEntry("recording", false);
        assertThat(result.getDetails()).containsEntry("transcription", false);
    }

    @Test
    void healthDistinguishesTheFeatureFlagFromIntegrationState() {
        assertThat(health.health().getDetails()).containsEntry("feature", "enabled");
    }

    @Test
    void healthDetailsCarryNoCredentialsOrEndpoints() {
        String rendered = health.health().getDetails().toString();

        // Booleans only: an unauthenticated health endpoint must not become a
        // configuration oracle.
        assertThat(rendered)
                .doesNotContain("livekit.cloud")
                .doesNotContain("wss://")
                .doesNotContain("secret")
                .doesNotContain("key");
    }

    @Test
    void lifecycleTransitionsAreCounted() {
        metrics.classTransition(OnlineClassStatus.LIVE);
        metrics.classTransition(OnlineClassStatus.LIVE);
        metrics.classTransition(OnlineClassStatus.ENDED);

        assertThat(registry.get("mcschool.onlineclass.lifecycle")
                .tag("status", "LIVE").counter().count()).isEqualTo(2.0);
        assertThat(registry.get("mcschool.onlineclass.lifecycle")
                .tag("status", "ENDED").counter().count()).isEqualTo(1.0);
    }

    @Test
    void webhookOutcomesAreCountedSeparately() {
        metrics.webhookAccepted();
        metrics.webhookRejected();
        metrics.webhookRejected();

        assertThat(registry.get("mcschool.onlineclass.webhook")
                .tag("outcome", "rejected").counter().count()).isEqualTo(2.0);
        assertThat(registry.get("mcschool.onlineclass.webhook")
                .tag("outcome", "accepted").counter().count()).isEqualTo(1.0);
    }

    @Test
    void rateLimitAndStorageFailuresAreCounted() {
        metrics.rateLimited("chat");
        metrics.storageFailure("delete");

        assertThat(registry.get("mcschool.onlineclass.ratelimited")
                .tag("subject", "chat").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("mcschool.onlineclass.storage.failure")
                .tag("operation", "delete").counter().count()).isEqualTo(1.0);
    }

    @Test
    void metricTagsStayLowCardinality() {
        metrics.participantJoined(true);
        metrics.participantJoined(false);

        // Tagged by role, never by class or user id: a metrics backend is not a
        // place for identifiers, and per-user series would explode.
        assertThat(registry.get("mcschool.onlineclass.participant.joined")
                .tag("role", "host").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("mcschool.onlineclass.participant.joined")
                .tag("role", "student").counter().count()).isEqualTo(1.0);
    }
}
