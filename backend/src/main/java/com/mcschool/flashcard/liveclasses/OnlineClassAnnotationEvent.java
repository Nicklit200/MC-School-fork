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
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * One operation in a document's ordered revision stream.
 *
 * <p>{@code operationId} is client-generated so the same operation arriving over
 * the realtime channel and over HTTP collapses onto one row; {@code sequence}
 * gives late joiners a deterministic replay order.
 */
@Entity
@Table(name = "online_class_annotation_events")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassAnnotationEvent {

    public static final int MAX_PAYLOAD_LENGTH = 16384;

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private OnlineClassAnnotationDocument document;

    @Column(name = "operation_id", nullable = false)
    private UUID operationId;

    @Column(nullable = false)
    private long sequence;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "actor_id", nullable = false)
    private User actor;

    /** The layer this operation belongs to, which drives per-layer clearing. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "layer_owner_id", nullable = false)
    private User layerOwner;

    @Enumerated(EnumType.STRING)
    @Column(name = "operation_type", nullable = false, length = 20)
    private AnnotationOperationType operationType;

    @Column(nullable = false, length = MAX_PAYLOAD_LENGTH)
    private String payload;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    private OnlineClassAnnotationEvent(OnlineClassAnnotationDocument document, UUID operationId,
                                       long sequence, User actor, User layerOwner,
                                       AnnotationOperationType operationType, String payload) {
        if (sequence <= 0) {
            throw new IllegalArgumentException("Annotation sequence must be positive");
        }
        if (payload == null || payload.isBlank()) {
            throw new IllegalArgumentException("Annotation payload must not be blank");
        }
        if (payload.length() > MAX_PAYLOAD_LENGTH) {
            throw new IllegalArgumentException(
                    "Annotation payload exceeds " + MAX_PAYLOAD_LENGTH + " characters");
        }
        this.id = UUID.randomUUID();
        this.document = document;
        this.operationId = operationId;
        this.sequence = sequence;
        this.actor = actor;
        this.layerOwner = layerOwner;
        this.operationType = operationType;
        this.payload = payload;
    }

    public static OnlineClassAnnotationEvent record(OnlineClassAnnotationDocument document, UUID operationId,
                                                    long sequence, User actor, User layerOwner,
                                                    AnnotationOperationType operationType, String payload) {
        return new OnlineClassAnnotationEvent(document, operationId, sequence, actor, layerOwner,
                operationType, payload);
    }
}
