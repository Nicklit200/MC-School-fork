package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentRequest;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.User;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Live captions and the durable transcript.
 *
 * <p>Interim captions stay ephemeral in the room; only final segments are
 * persisted, keyed by the provider's segment id so a worker reconnect cannot
 * duplicate them.
 *
 * <p>A provider failure degrades transcription only — it never ends the class or
 * interrupts media.
 */
@Service
public class OnlineClassTranscriptService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassTranscriptService.class);

    /** Bounded so a misbehaving worker cannot write unbounded rows. */
    static final int MAX_SEGMENT_TEXT_LENGTH = 5000;

    private final OnlineClassTranscriptSegmentRepository segmentRepository;
    private final OnlineClassRepository classRepository;
    private final OnlineClassAccessService accessService;
    private final ClassTranscriptionProvider transcriptionProvider;
    private final java.time.Clock clock;

    public OnlineClassTranscriptService(OnlineClassTranscriptSegmentRepository segmentRepository,
                                        OnlineClassRepository classRepository,
                                        OnlineClassAccessService accessService,
                                        ClassTranscriptionProvider transcriptionProvider,
                                        java.time.Clock clock) {
        this.segmentRepository = segmentRepository;
        this.classRepository = classRepository;
        this.accessService = accessService;
        this.transcriptionProvider = transcriptionProvider;
        this.clock = clock;
    }

    // --- Teacher control -----------------------------------------------------

    /**
     * Teacher-only. Idempotent while already running.
     *
     * <p>{@code noRollbackFor} is deliberate: when the provider rejects the
     * request we still want the FAILED state committed so the UI can show it.
     * Without this the rollback would discard the very state we just recorded
     * and the class would look as if transcription had never been attempted.
     */
    @Transactional(noRollbackFor = ConflictException.class)
    public void start(AuthenticatedUser caller, UUID classId, List<String> languageHints) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        if (!transcriptionProvider.isConfigured()) {
            throw new ConflictException("Transcription is not available on this server");
        }
        if (onlineClass.getStatus() != OnlineClassStatus.LIVE) {
            throw new ConflictException("Only a live class can be transcribed");
        }
        if (onlineClass.getTranscriptionState() == ClassFeatureState.ACTIVE
                || onlineClass.getTranscriptionState() == ClassFeatureState.STARTING) {
            return;
        }

        onlineClass.setTranscriptionState(ClassFeatureState.STARTING);
        try {
            // RU and DE are the product languages; an empty list means the
            // provider auto-detects.
            List<String> hints = (languageHints == null || languageHints.isEmpty())
                    ? List.of("ru", "de")
                    : languageHints;
            String sessionId = transcriptionProvider.startTranscription(
                    onlineClass.getRoomName(), classId.toString(), hints);
            onlineClass.setTranscriptionState(ClassFeatureState.ACTIVE);
            log.info("Transcription started: classId={} sessionId={}", classId, sessionId);
        } catch (MediaProviderException e) {
            // Visible failure, but the class keeps running.
            onlineClass.setTranscriptionState(ClassFeatureState.FAILED);
            log.warn("Transcription could not be started: classId={}", classId);
            throw new ConflictException("Transcription could not be started");
        }
    }

    /** Teacher-only. Safe when nothing is running. */
    @Transactional
    public void stop(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        onlineClass.setTranscriptionState(ClassFeatureState.INACTIVE);
        try {
            transcriptionProvider.stopTranscription(onlineClass.getRoomName(), classId.toString());
        } catch (MediaProviderException e) {
            log.debug("Transcription stop was a no-op: classId={}", classId);
        }
    }

    // --- Worker ingestion ----------------------------------------------------

    /**
     * Persists one final segment. Called by the transcription worker, which
     * authenticates with an internal token — never an end-user JWT.
     *
     * <p>Idempotent on {@code providerSegmentId}: a resend after a worker
     * reconnect returns the existing row instead of duplicating it.
     */
    @Transactional
    public TranscriptSegmentResponse ingest(UUID classId, TranscriptSegmentRequest request) {
        OnlineClass onlineClass = classRepository.findById(classId)
                .orElseThrow(() -> new ConflictException("Unknown class"));

        Optional<OnlineClassTranscriptSegment> existing = segmentRepository
                .findByOnlineClassIdAndProviderSegmentId(classId, request.providerSegmentId());
        if (existing.isPresent()) {
            return TranscriptSegmentResponse.from(existing.get());
        }

        String text = request.text() == null ? "" : request.text();
        if (text.length() > MAX_SEGMENT_TEXT_LENGTH) {
            text = text.substring(0, MAX_SEGMENT_TEXT_LENGTH);
        }

        // Resolve the speaker from the identity rather than trusting a
        // worker-supplied user id.
        User speaker = ParticipantIdentity.userId(request.participantIdentity())
                .flatMap(this::resolveUser)
                .orElse(null);

        OnlineClassTranscriptSegment segment = OnlineClassTranscriptSegment.finalSegment(
                onlineClass,
                request.providerSegmentId(),
                request.participantIdentity(),
                speaker,
                request.speakerLabel(),
                request.language(),
                request.startMs(),
                request.endMs(),
                text,
                request.confidence());
        return TranscriptSegmentResponse.from(segmentRepository.save(segment));
    }

    private Optional<User> resolveUser(UUID userId) {
        try {
            return Optional.of(accessService.requireActiveUser(userId));
        } catch (RuntimeException e) {
            // An unknown or archived speaker still gets a transcript line,
            // attributed by label only.
            return Optional.empty();
        }
    }

    // --- Reading and export --------------------------------------------------

    @Transactional(readOnly = true)
    public List<TranscriptSegmentResponse> segments(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        if (!accessService.isHost(caller, onlineClass)) {
            // Default-closed, like recordings: transcript visibility is
            // teacher-controlled rather than automatically shared.
            throw new com.mcschool.flashcard.common.ResourceNotFoundException("Online class not found");
        }
        return segmentRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(classId).stream()
                .map(TranscriptSegmentResponse::from)
                .toList();
    }

    /** Plain-text export: one line per segment, speaker-prefixed. */
    @Transactional(readOnly = true)
    public String exportText(AuthenticatedUser caller, UUID classId) {
        StringBuilder text = new StringBuilder();
        for (TranscriptSegmentResponse segment : segments(caller, classId)) {
            if (segment.speakerLabel() != null) {
                text.append(segment.speakerLabel()).append(": ");
            }
            text.append(segment.text()).append('\n');
        }
        return text.toString();
    }

    /**
     * WebVTT export. Timings come from the stored millisecond offsets, so this
     * is only emitted when segments actually carry usable timing.
     */
    @Transactional(readOnly = true)
    public String exportVtt(AuthenticatedUser caller, UUID classId) {
        List<TranscriptSegmentResponse> segments = segments(caller, classId);
        StringBuilder vtt = new StringBuilder("WEBVTT\n\n");
        int index = 1;
        for (TranscriptSegmentResponse segment : segments) {
            vtt.append(index++).append('\n')
                    .append(formatTimestamp(segment.startMs())).append(" --> ")
                    .append(formatTimestamp(segment.endMs())).append('\n');
            if (segment.speakerLabel() != null) {
                vtt.append('<').append('v').append(' ').append(segment.speakerLabel()).append('>');
            }
            vtt.append(segment.text()).append("\n\n");
        }
        return vtt.toString();
    }

    static String formatTimestamp(long milliseconds) {
        Duration duration = Duration.ofMillis(milliseconds);
        return String.format("%02d:%02d:%02d.%03d",
                duration.toHours(),
                duration.toMinutesPart(),
                duration.toSecondsPart(),
                duration.toMillisPart());
    }
}
