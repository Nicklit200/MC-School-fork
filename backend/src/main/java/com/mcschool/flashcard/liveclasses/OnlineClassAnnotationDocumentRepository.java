package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OnlineClassAnnotationDocumentRepository
        extends JpaRepository<OnlineClassAnnotationDocument, UUID> {

    Optional<OnlineClassAnnotationDocument> findByOnlineClassIdAndTargetTypeAndTargetIdAndPageIndex(
            UUID classId, AnnotationTargetType targetType, String targetId, int pageIndex);

    List<OnlineClassAnnotationDocument> findAllByOnlineClassIdOrderByPageIndexAsc(UUID classId);

    Optional<OnlineClassAnnotationDocument> findByIdAndOnlineClassId(UUID id, UUID classId);

    /**
     * All writers to one page MUST acquire this database row lock before
     * reading/incrementing revision or checking an operation ID. A Java lock
     * does not protect a Railway deployment with multiple instances.
     *
     * PostgreSQL SELECT FOR UPDATE serializes concurrent Pencil strokes and
     * retry requests, keeping both (document_id, sequence) and
     * (document_id, operation_id) unique without dropping annotations.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            SELECT d FROM OnlineClassAnnotationDocument d
            WHERE d.id = :id AND d.onlineClass.id = :classId
            """)
    Optional<OnlineClassAnnotationDocument> findForUpdate(
            @Param("id") UUID id, @Param("classId") UUID classId);

    /**
     * Creates the document unless one already exists for this surface and page.
     *
     * <p>Two people opening the same page at once both find nothing; a plain
     * insert would make the loser fail with a unique-key violation (a 500).
     * {@code ON CONFLICT DO NOTHING} lets the loser carry on and read the
     * winner's row instead. Revision, timestamps and version take their column
     * defaults.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO online_class_annotation_documents (id, class_id, target_type, target_id, page_index)
            VALUES (:id, :classId, :targetType, :targetId, :pageIndex)
            ON CONFLICT (class_id, target_type, target_id, page_index) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("classId") UUID classId,
                       @Param("targetType") String targetType, @Param("targetId") String targetId,
                       @Param("pageIndex") int pageIndex);
}
