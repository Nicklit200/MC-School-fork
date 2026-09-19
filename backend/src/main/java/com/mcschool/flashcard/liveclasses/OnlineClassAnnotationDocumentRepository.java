package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassAnnotationDocumentRepository
        extends JpaRepository<OnlineClassAnnotationDocument, UUID> {

    Optional<OnlineClassAnnotationDocument> findByOnlineClassIdAndTargetTypeAndTargetIdAndPageIndex(
            UUID classId, AnnotationTargetType targetType, String targetId, int pageIndex);

    List<OnlineClassAnnotationDocument> findAllByOnlineClassIdOrderByPageIndexAsc(UUID classId);

    Optional<OnlineClassAnnotationDocument> findByIdAndOnlineClassId(UUID id, UUID classId);
}
