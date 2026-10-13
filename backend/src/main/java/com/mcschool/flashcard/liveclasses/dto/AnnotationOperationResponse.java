package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.AnnotationOperationType;
import com.mcschool.flashcard.liveclasses.OnlineClassAnnotationEvent;
import java.time.Instant;
import java.util.UUID;

/** A stored operation, as replayed to a late joiner. */
public record AnnotationOperationResponse(
        UUID id,
        UUID operationId,
        long sequence,
        UUID actorId,
        UUID layerOwnerId,
        AnnotationOperationType operationType,
        String payload,
        Instant createdAt
) {

    public static AnnotationOperationResponse from(OnlineClassAnnotationEvent source) {
        return new AnnotationOperationResponse(
                source.getId(),
                source.getOperationId(),
                source.getSequence(),
                source.getActor().getId(),
                source.getLayerOwner().getId(),
                source.getOperationType(),
                source.getPayload(),
                source.getCreatedAt());
    }
}
