package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Metadata for one class recording. The media itself lives in S3-compatible
 * object storage under {@code storageObjectKey}; bytes are never stored here.
 *
 * <p>READY and FAILED are only ever set from a signature-verified provider
 * webhook, which is the authoritative completion signal.
 */
@Entity
@Table(name = "online_class_recordings")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassRecording {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @Column(name = "egress_id", length = 255)
    private String egressId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private RecordingStatus status;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "requested_by", nullable = false)
    private User requestedBy;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "storage_object_key", length = 512)
    private String storageObjectKey;

    @Column(name = "mime_type", length = 100)
    private String mimeType;

    @Column(name = "byte_size")
    private Long byteSize;

    @Column(name = "duration_seconds")
    private Long durationSeconds;

    @Column(name = "failure_reason", length = 1000)
    private String failureReason;

    @Column(name = "delete_after")
    private Instant deleteAfter;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassRecording(OnlineClass onlineClass, User requestedBy, Instant requestedAt) {
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.requestedBy = requestedBy;
        this.requestedAt = requestedAt;
        this.status = RecordingStatus.REQUESTED;
    }

    public static OnlineClassRecording request(OnlineClass onlineClass, User requestedBy, Instant now) {
        return new OnlineClassRecording(onlineClass, requestedBy, now);
    }

    /** True once the provider can no longer change this recording's outcome. */
    public boolean isTerminal() {
        return status == RecordingStatus.READY
                || status == RecordingStatus.FAILED
                || status == RecordingStatus.DELETED;
    }

    public boolean isPlayable() {
        return status == RecordingStatus.READY && deletedAt == null && storageObjectKey != null;
    }

    public void markStarting(String egressId) {
        this.egressId = egressId;
        this.status = RecordingStatus.STARTING;
    }

    public void markActive(Instant startedAt) {
        if (isTerminal()) {
            return;
        }
        this.status = RecordingStatus.ACTIVE;
        if (this.startedAt == null) {
            this.startedAt = startedAt;
        }
    }

    public void markProcessing() {
        if (isTerminal()) {
            return;
        }
        this.status = RecordingStatus.PROCESSING;
    }

    /**
     * Idempotent: a duplicate completion webhook for an already-ready recording
     * is ignored rather than re-writing the stored object metadata.
     */
    public void markReady(String storageObjectKey, String mimeType, Long byteSize,
                          Long durationSeconds, Instant endedAt, Instant deleteAfter) {
        if (status == RecordingStatus.READY || status == RecordingStatus.DELETED) {
            return;
        }
        this.status = RecordingStatus.READY;
        this.storageObjectKey = storageObjectKey;
        this.mimeType = mimeType;
        this.byteSize = byteSize;
        this.durationSeconds = durationSeconds;
        this.endedAt = endedAt;
        this.deleteAfter = deleteAfter;
        this.failureReason = null;
    }

    public void markFailed(String reason, Instant endedAt) {
        if (status == RecordingStatus.READY || status == RecordingStatus.DELETED) {
            return;
        }
        this.status = RecordingStatus.FAILED;
        this.failureReason = truncate(reason);
        this.endedAt = endedAt;
    }

    /** Marks the row deleted once the external object is gone. */
    public void markDeleted(Instant now) {
        this.status = RecordingStatus.DELETED;
        this.deletedAt = now;
        this.storageObjectKey = null;
    }

    private static String truncate(String reason) {
        if (reason == null) {
            return null;
        }
        return reason.length() <= 1000 ? reason : reason.substring(0, 1000);
    }
}
