package com.mcschool.flashcard.liveclasses;

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
 * One annotated surface: a whiteboard page, or an overlay on a screen share.
 *
 * <p>Coordinates in the operation stream are normalized to this surface (0..1)
 * rather than CSS pixels, so a late joiner on a different screen size replays
 * the same drawing. {@code sourceWidth}/{@code sourceHeight} retain the original
 * aspect ratio for faithful reproduction.
 */
@Entity
@Table(name = "online_class_annotation_documents")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassAnnotationDocument {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 20)
    private AnnotationTargetType targetType;

    @Column(name = "target_id", nullable = false, length = 255)
    private String targetId;

    @Column(name = "page_index", nullable = false)
    private int pageIndex;

    @Column(name = "source_width")
    private Integer sourceWidth;

    @Column(name = "source_height")
    private Integer sourceHeight;

    @Column(nullable = false)
    private long revision;

    @Column(name = "snapshot_object_key", length = 512)
    private String snapshotObjectKey;

    @Column(name = "snapshot_saved_at")
    private Instant snapshotSavedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassAnnotationDocument(OnlineClass onlineClass, AnnotationTargetType targetType,
                                          String targetId, int pageIndex) {
        if (pageIndex < 0) {
            throw new IllegalArgumentException("Page index must not be negative");
        }
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.targetType = targetType;
        this.targetId = targetId;
        this.pageIndex = pageIndex;
        this.revision = 0L;
    }

    public static OnlineClassAnnotationDocument create(OnlineClass onlineClass,
                                                       AnnotationTargetType targetType,
                                                       String targetId, int pageIndex) {
        return new OnlineClassAnnotationDocument(onlineClass, targetType, targetId, pageIndex);
    }

    public void describeSource(Integer width, Integer height) {
        if (width != null && width <= 0) {
            throw new IllegalArgumentException("Source width must be positive");
        }
        if (height != null && height <= 0) {
            throw new IllegalArgumentException("Source height must be positive");
        }
        this.sourceWidth = width;
        this.sourceHeight = height;
    }

    /** Allocates the next sequence number in this document's revision stream. */
    public long nextRevision() {
        this.revision += 1;
        return this.revision;
    }

    public void recordSnapshot(String objectKey, Instant savedAt) {
        this.snapshotObjectKey = objectKey;
        this.snapshotSavedAt = savedAt;
    }
}
