package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deletes class artifacts once their retention window has elapsed.
 *
 * <p>Deletion of an external object is <em>retryable and observable</em>: the row
 * is only marked deleted after the object store confirms removal, so a failed
 * delete is retried on the next sweep instead of leaving an orphaned file that
 * the database believes is gone.
 */
@Service
public class ClassRetentionService {

    private static final Logger log = LoggerFactory.getLogger(ClassRetentionService.class);

    /** Bounded per run so one sweep cannot monopolise the database. */
    static final int MAX_PER_RUN = 200;

    private final OnlineClassRecordingRepository recordingRepository;
    private final OnlineClassTranscriptSegmentRepository transcriptRepository;
    private final OnlineClassRepository classRepository;
    private final ClassArtifactStorage storage;
    private final ClassStorageProperties storageProperties;
    private final OnlineClassMetrics metrics;
    private final Clock clock;

    public ClassRetentionService(OnlineClassRecordingRepository recordingRepository,
                                 OnlineClassTranscriptSegmentRepository transcriptRepository,
                                 OnlineClassRepository classRepository,
                                 ClassArtifactStorage storage,
                                 ClassStorageProperties storageProperties,
                                 OnlineClassMetrics metrics,
                                 Clock clock) {
        this.recordingRepository = recordingRepository;
        this.transcriptRepository = transcriptRepository;
        this.classRepository = classRepository;
        this.storage = storage;
        this.storageProperties = storageProperties;
        this.metrics = metrics;
        this.clock = clock;
    }

    /** Result of one sweep, returned so it can be logged and asserted. */
    public record RetentionSweepResult(int recordingsDeleted, int recordingsFailed,
                                       int transcriptsDeleted) {
    }

    /**
     * Deletes recordings whose retention window has passed.
     *
     * <p>Only marks a row DELETED after the object store confirms. A storage
     * outage therefore leaves the row eligible for the next sweep rather than
     * silently orphaning the file.
     */
    @Transactional
    public RetentionSweepResult sweepRecordings() {
        if (!storage.isConfigured()) {
            return new RetentionSweepResult(0, 0, 0);
        }
        List<OnlineClassRecording> expired = recordingRepository
                .findAllByStatusAndDeleteAfterBeforeAndDeletedAtIsNull(
                        RecordingStatus.READY, clock.instant())
                .stream()
                .limit(MAX_PER_RUN)
                .toList();

        int deleted = 0;
        int failed = 0;
        for (OnlineClassRecording recording : expired) {
            String objectKey = recording.getStorageObjectKey();
            try {
                if (objectKey != null) {
                    storage.delete(objectKey);
                }
                recording.markDeleted(clock.instant());
                deleted++;
            } catch (RuntimeException e) {
                // Left untouched so the next sweep retries it. Never log the
                // object key alongside credentials or a signed URL.
                failed++;
                metrics.storageFailure("delete");
                log.warn("Retention: could not delete a recording object; will retry next sweep");
            }
        }
        if (deleted > 0 || failed > 0) {
            log.info("Retention sweep: recordingsDeleted={} recordingsFailed={}", deleted, failed);
        }
        return new RetentionSweepResult(deleted, failed, 0);
    }

    /**
     * Deletes transcript segments for classes that ended beyond the transcript
     * retention window.
     *
     * <p>Transcripts live only in PostgreSQL, so there is no external object to
     * reconcile — but the class row is kept: attendance is an educational
     * record with its own, longer life.
     */
    @Transactional
    public RetentionSweepResult sweepTranscripts() {
        Instant cutoff = clock.instant()
                .minus(Duration.ofDays(storageProperties.transcriptRetentionDays()));

        List<OnlineClass> expired = classRepository
                .findAllByStatusAndActualEndAtBefore(OnlineClassStatus.ENDED, cutoff)
                .stream()
                .limit(MAX_PER_RUN)
                .toList();

        int cleared = 0;
        for (OnlineClass onlineClass : expired) {
            if (!transcriptRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(
                    onlineClass.getId()).isEmpty()) {
                transcriptRepository.deleteAllByOnlineClassId(onlineClass.getId());
                cleared++;
            }
        }
        if (cleared > 0) {
            log.info("Retention sweep: transcriptsCleared={}", cleared);
        }
        return new RetentionSweepResult(0, 0, cleared);
    }

    /**
     * Deletes every external artifact for one class, for an explicit deletion
     * request rather than the retention clock.
     *
     * @return true when everything external was removed; false leaves rows
     *         eligible for a retry
     */
    @Transactional
    public boolean deleteClassArtifacts(java.util.UUID classId) {
        boolean complete = true;
        for (OnlineClassRecording recording :
                recordingRepository.findAllByOnlineClassIdOrderByRequestedAtDesc(classId)) {
            if (recording.getDeletedAt() != null) {
                continue;
            }
            try {
                if (recording.getStorageObjectKey() != null) {
                    storage.delete(recording.getStorageObjectKey());
                }
                recording.markDeleted(clock.instant());
            } catch (RuntimeException e) {
                complete = false;
                metrics.storageFailure("delete");
                log.warn("Deletion: a recording object could not be removed; will retry");
            }
        }
        transcriptRepository.deleteAllByOnlineClassId(classId);
        log.info("Class artifacts deleted: classId={} complete={}", classId, complete);
        return complete;
    }
}
