package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassAnnotationEventRepository
        extends JpaRepository<OnlineClassAnnotationEvent, UUID> {

    /** Realtime/HTTP de-duplication for the same client operation. */
    Optional<OnlineClassAnnotationEvent> findByDocumentIdAndOperationId(UUID documentId, UUID operationId);

    /** Replay for a late joiner or a reconnect, from a known revision forward. */
    List<OnlineClassAnnotationEvent> findAllByDocumentIdAndSequenceGreaterThanOrderBySequenceAsc(
            UUID documentId, long afterSequence);

    List<OnlineClassAnnotationEvent> findAllByDocumentIdOrderBySequenceAsc(UUID documentId);
}
