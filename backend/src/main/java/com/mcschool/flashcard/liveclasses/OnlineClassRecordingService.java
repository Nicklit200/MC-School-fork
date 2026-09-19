package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.RecordingResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Teacher-controlled class recording.
 *
 * <p>Starting is a request, not a result: the authoritative outcome arrives
 * later on a signature-verified webhook. Until then the recording sits in
 * REQUESTED/STARTING and the UI says so rather than claiming success.
 */
@Service
public class OnlineClassRecordingService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassRecordingService.class);

    private final OnlineClassRecordingRepository recordingRepository;
    private final OnlineClassParticipantRepository participantRepository;
    private final OnlineClassRepository classRepository;
    private final OnlineClassAccessService accessService;
    private final ClassRecordingProvider recordingProvider;
    private final ClassArtifactStorage storage;
    private final ClassStorageProperties storageProperties;
    private final Clock clock;

    public OnlineClassRecordingService(OnlineClassRecordingRepository recordingRepository,
                                       OnlineClassParticipantRepository participantRepository,
                                       OnlineClassRepository classRepository,
                                       OnlineClassAccessService accessService,
                                       ClassRecordingProvider recordingProvider,
                                       ClassArtifactStorage storage,
                                       ClassStorageProperties storageProperties,
                                       Clock clock) {
        this.recordingRepository = recordingRepository;
        this.participantRepository = participantRepository;
        this.classRepository = classRepository;
        this.accessService = accessService;
        this.recordingProvider = recordingProvider;
        this.storage = storage;
        this.storageProperties = storageProperties;
        this.clock = clock;
    }

    /**
     * Teacher-only. Idempotent: an already-running recording is returned as-is.
     *
     * <p>{@code noRollbackFor} keeps the FAILED recording row when the provider
     * rejects the request — otherwise the rollback would erase the failure and
     * the teacher would see no explanation at all.
     */
    @Transactional(noRollbackFor = ConflictException.class)
    public RecordingResponse start(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        if (!recordingProvider.isConfigured()) {
            throw new ConflictException("Recording is not available on this server");
        }
        if (onlineClass.getStatus() != OnlineClassStatus.LIVE) {
            throw new ConflictException("Only a live class can be recorded");
        }

        Optional<OnlineClassRecording> running = activeRecording(classId);
        if (running.isPresent()) {
            return RecordingResponse.from(running.get(), null);
        }

        User requester = accessService.requireActiveUser(caller.id());
        OnlineClassRecording recording = recordingRepository.save(
                OnlineClassRecording.request(onlineClass, requester, now()));
        onlineClass.setRecordingState(ClassFeatureState.STARTING);

        String objectKey = storage.buildObjectKey(classId.toString(), "recording.mp4");
        try {
            String egressId = recordingProvider.startRoomRecording(onlineClass.getRoomName(), objectKey);
            recording.markStarting(egressId);
            log.info("Recording requested: classId={} egressId={}", classId, egressId);
        } catch (MediaProviderException e) {
            // Fail visibly rather than leaving the class in a permanent
            // "starting" state.
            recording.markFailed("Provider rejected the recording request", now());
            onlineClass.setRecordingState(ClassFeatureState.FAILED);
            log.warn("Recording could not be started: classId={}", classId);
            throw new ConflictException("Recording could not be started");
        }
        return RecordingResponse.from(recording, null);
    }

    /** Teacher-only. Safe to call when nothing is running. */
    @Transactional
    public RecordingResponse stop(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        OnlineClassRecording recording = activeRecording(classId)
                .orElseThrow(() -> new ConflictException("No recording is running"));

        onlineClass.setRecordingState(ClassFeatureState.STOPPING);
        if (recording.getEgressId() != null) {
            recordingProvider.stopRecording(recording.getEgressId());
        }
        // PROCESSING, not READY: only the webhook may declare completion.
        recording.markProcessing();
        return RecordingResponse.from(recording, null);
    }

    /**
     * Recordings for a class. Signed URLs are minted only for the teacher — a
     * student's visibility is teacher-controlled and defaults to closed.
     */
    @Transactional(readOnly = true)
    public List<RecordingResponse> list(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        boolean host = accessService.isHost(caller, onlineClass);
        if (!host) {
            // Default-closed: students do not receive recordings in this release.
            throw new ResourceNotFoundException("Online class not found");
        }
        return recordingRepository.findAllByOnlineClassIdOrderByRequestedAtDesc(classId).stream()
                .map(recording -> RecordingResponse.from(recording, signedUrlFor(recording)))
                .toList();
    }

    /** Records that a participant saw the recording notice before publishing. */
    @Transactional
    public void acknowledgeRecording(AuthenticatedUser caller, UUID classId) {
        accessService.requireParticipant(caller, classId);
        participantRepository.findByOnlineClassIdAndUserId(classId, caller.id())
                .ifPresent(participant -> participant.acknowledgeRecording(now()));
    }

    // --- Webhook reconciliation ---------------------------------------------

    /**
     * Applies a verified provider event. Idempotent and order-tolerant: a
     * duplicate or late event cannot move a finished recording backwards.
     */
    @Transactional
    public void applyEgressUpdate(String egressId, EgressOutcome outcome, String objectKey,
                                  Long byteSize, Long durationSeconds, String failureReason) {
        Optional<OnlineClassRecording> found = recordingRepository.findByEgressId(egressId);
        if (found.isEmpty()) {
            // An unknown egress id is ignored rather than creating state from
            // an event we cannot attribute.
            log.warn("Ignoring provider event for an unknown egressId");
            return;
        }
        OnlineClassRecording recording = found.get();
        OnlineClass onlineClass = recording.getOnlineClass();

        switch (outcome) {
            case ACTIVE -> {
                recording.markActive(now());
                onlineClass.setRecordingState(ClassFeatureState.ACTIVE);
            }
            case COMPLETED -> {
                Instant deleteAfter = now().plus(
                        Duration.ofDays(storageProperties.recordingRetentionDays()));
                recording.markReady(objectKey, "video/mp4", byteSize, durationSeconds,
                        now(), deleteAfter);
                onlineClass.setRecordingState(ClassFeatureState.INACTIVE);
            }
            case FAILED -> {
                recording.markFailed(failureReason, now());
                onlineClass.setRecordingState(ClassFeatureState.FAILED);
            }
        }
        classRepository.save(onlineClass);
        log.info("Recording state reconciled from provider event: outcome={}", outcome);
    }

    public enum EgressOutcome { ACTIVE, COMPLETED, FAILED }

    private Optional<OnlineClassRecording> activeRecording(UUID classId) {
        return recordingRepository.findAllByOnlineClassIdAndStatusIn(classId,
                        List.of(RecordingStatus.REQUESTED, RecordingStatus.STARTING,
                                RecordingStatus.ACTIVE))
                .stream()
                .findFirst();
    }

    private String signedUrlFor(OnlineClassRecording recording) {
        if (!recording.isPlayable() || !storage.isConfigured()) {
            return null;
        }
        return storage.createSignedDownloadUrl(recording.getStorageObjectKey(),
                storageProperties.signedUrlTtl()).orElse(null);
    }

    private Instant now() {
        return clock.instant();
    }
}
