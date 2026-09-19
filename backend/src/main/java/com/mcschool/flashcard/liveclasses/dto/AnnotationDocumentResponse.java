package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.AnnotationTargetType;
import com.mcschool.flashcard.liveclasses.OnlineClassAnnotationDocument;
import java.time.Instant;
import java.util.UUID;

/**
 * An annotated surface.
 *
 * <p>{@code sourceWidth}/{@code sourceHeight} describe the shared source so a
 * viewer on a different screen reproduces the original aspect ratio; the
 * operations themselves are normalized to 0..1.
 */
public record AnnotationDocumentResponse(
        UUID id,
        AnnotationTargetType targetType,
        String targetId,
        int pageIndex,
        Integer sourceWidth,
        Integer sourceHeight,
        long revision,
        Instant snapshotSavedAt
) {

    public static AnnotationDocumentResponse from(OnlineClassAnnotationDocument source) {
        return new AnnotationDocumentResponse(
                source.getId(),
                source.getTargetType(),
                source.getTargetId(),
                source.getPageIndex(),
                source.getSourceWidth(),
                source.getSourceHeight(),
                source.getRevision(),
                source.getSnapshotSavedAt());
    }
}
