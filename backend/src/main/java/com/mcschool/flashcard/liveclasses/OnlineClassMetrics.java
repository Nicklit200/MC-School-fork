package com.mcschool.flashcard.liveclasses;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Privacy-safe counters for online classes.
 *
 * <p>Tags are low-cardinality and structural only. Nothing here records a class
 * id, user id, token, media URL, chat body or transcript text — a metrics
 * backend is not an appropriate place for any of those, and high-cardinality
 * tags would also blow up the series count.
 */
@Component
public class OnlineClassMetrics {

    private final MeterRegistry registry;

    public OnlineClassMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** Class lifecycle transitions, tagged by the target state. */
    public void classTransition(OnlineClassStatus status) {
        counter("mcschool.onlineclass.lifecycle", "status", status.name()).increment();
    }

    /** A participant connected or reconnected. */
    public void participantJoined(boolean host) {
        counter("mcschool.onlineclass.participant.joined", "role", host ? "host" : "student")
                .increment();
    }

    public void participantLeft() {
        counter("mcschool.onlineclass.participant.left", "role", "any").increment();
    }

    /** A provider call failed. The reason is a short structural label, never a message. */
    public void providerFailure(String operation) {
        counter("mcschool.onlineclass.provider.failure", "operation", operation).increment();
    }

    public void recordingState(ClassFeatureState state) {
        counter("mcschool.onlineclass.recording.state", "state", state.name()).increment();
    }

    public void transcriptionState(ClassFeatureState state) {
        counter("mcschool.onlineclass.transcription.state", "state", state.name()).increment();
    }

    /** Webhook outcomes; a rising rejection rate is the signal worth alerting on. */
    public void webhookRejected() {
        counter("mcschool.onlineclass.webhook", "outcome", "rejected").increment();
    }

    public void webhookAccepted() {
        counter("mcschool.onlineclass.webhook", "outcome", "accepted").increment();
    }

    public void webhookDuplicate() {
        counter("mcschool.onlineclass.webhook", "outcome", "duplicate").increment();
    }

    /** A request was refused by a limit; `subject` is chat, annotation, etc. */
    public void rateLimited(String subject) {
        counter("mcschool.onlineclass.ratelimited", "subject", subject).increment();
    }

    public void storageFailure(String operation) {
        counter("mcschool.onlineclass.storage.failure", "operation", operation).increment();
    }

    public void transcriptSegmentsIngested(int count) {
        counter("mcschool.onlineclass.transcript.segments", "kind", "final").increment(count);
    }

    private Counter counter(String name, String tagKey, String tagValue) {
        return Counter.builder(name).tag(tagKey, tagValue).register(registry);
    }
}
