package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassTranscriptSegmentRepository
        extends JpaRepository<OnlineClassTranscriptSegment, UUID> {

    /** Ingestion idempotency: a resent final collapses onto the existing row. */
    Optional<OnlineClassTranscriptSegment> findByOnlineClassIdAndProviderSegmentId(
            UUID classId, String providerSegmentId);

    List<OnlineClassTranscriptSegment> findAllByOnlineClassIdOrderByStartMsAscIdAsc(UUID classId);

    void deleteAllByOnlineClassId(UUID classId);
}
