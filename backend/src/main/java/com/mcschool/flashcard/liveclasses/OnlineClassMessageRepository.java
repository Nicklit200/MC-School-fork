package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OnlineClassMessageRepository extends JpaRepository<OnlineClassMessage, UUID> {

    /** Idempotency lookup for a retried send. */
    Optional<OnlineClassMessage> findByOnlineClassIdAndClientMessageId(UUID classId, UUID clientMessageId);

    Optional<OnlineClassMessage> findByIdAndOnlineClassId(UUID id, UUID classId);

    /** Newest-first page used for cursor pagination; the client reverses it. */
    @Query("""
            SELECT m FROM OnlineClassMessage m
            WHERE m.onlineClass.id = :classId
              AND (:beforeId IS NULL OR m.createdAt < (
                    SELECT c.createdAt FROM OnlineClassMessage c WHERE c.id = :beforeId
              ))
            ORDER BY m.createdAt DESC, m.id DESC
            """)
    List<OnlineClassMessage> findPage(@Param("classId") UUID classId,
                                      @Param("beforeId") UUID beforeId,
                                      Pageable pageable);

    long countByOnlineClassId(UUID classId);

    /** Backs rate limiting; counted in the database so it holds across instances. */
    long countByOnlineClassIdAndSenderIdAndCreatedAtAfter(
            UUID classId, UUID senderId, java.time.Instant since);
}
