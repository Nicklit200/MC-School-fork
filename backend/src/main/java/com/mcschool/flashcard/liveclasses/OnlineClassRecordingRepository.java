package com.mcschool.flashcard.liveclasses;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassRecordingRepository extends JpaRepository<OnlineClassRecording, UUID> {

    /** Webhook reconciliation entry point. */
    Optional<OnlineClassRecording> findByEgressId(String egressId);

    Optional<OnlineClassRecording> findByIdAndOnlineClassId(UUID id, UUID classId);

    List<OnlineClassRecording> findAllByOnlineClassIdOrderByRequestedAtDesc(UUID classId);

    List<OnlineClassRecording> findAllByOnlineClassIdAndStatusIn(
            UUID classId, List<RecordingStatus> statuses);

    /** Retention sweep: ready recordings whose retention window has elapsed. */
    List<OnlineClassRecording> findAllByStatusAndDeleteAfterBeforeAndDeletedAtIsNull(
            RecordingStatus status, Instant cutoff);
}
