package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * A final transcript segment. Interim captions stay ephemeral in the room and
 * are never persisted.
 *
 * <p>{@code providerSegmentId} is the ingestion idempotency key: after a worker
 * reconnect the provider may resend finals, and a unique index on
 * (class, providerSegmentId) collapses them onto one row.
 */
@Entity
@Table(name = "online_class_transcript_segments")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassTranscriptSegment {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @Column(name = "provider_segment_id", nullable = false, length = 255)
    private String providerSegmentId;

    @Column(name = "participant_identity", length = 255)
    private String participantIdentity;

    /** Resolved when the provider identity maps to a known application user. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "speaker_label", length = 120)
    private String speakerLabel;

    @Column(length = 20)
    private String language;

    @Column(name = "start_ms", nullable = false)
    private long startMs;

    @Column(name = "end_ms", nullable = false)
    private long endMs;

    @Column(nullable = false, columnDefinition = "text")
    private String text;

    private Double confidence;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassTranscriptSegment(OnlineClass onlineClass, String providerSegmentId,
                                         String participantIdentity, User user, String speakerLabel,
                                         String language, long startMs, long endMs,
                                         String text, Double confidence) {
        if (startMs < 0 || endMs < startMs) {
            throw new IllegalArgumentException("Transcript segment has an invalid time range");
        }
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.providerSegmentId = providerSegmentId;
        this.participantIdentity = participantIdentity;
        this.user = user;
        this.speakerLabel = speakerLabel;
        this.language = language;
        this.startMs = startMs;
        this.endMs = endMs;
        this.text = text == null ? "" : text;
        this.confidence = confidence;
    }

    public static OnlineClassTranscriptSegment finalSegment(
            OnlineClass onlineClass, String providerSegmentId, String participantIdentity, User user,
            String speakerLabel, String language, long startMs, long endMs, String text, Double confidence) {
        return new OnlineClassTranscriptSegment(onlineClass, providerSegmentId, participantIdentity, user,
                speakerLabel, language, startMs, endMs, text, confidence);
    }
}
