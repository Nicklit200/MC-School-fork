package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.ClassParticipantResponse;
import com.mcschool.flashcard.liveclasses.dto.ParticipantPermissionRequest;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaGrant;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Teacher-only moderation.
 *
 * <p>Every control is applied to the provider from the backend using server
 * credentials — a browser token never carries moderation rights — and durable
 * state is updated alongside so the effect survives a reconnect.
 */
@Service
public class OnlineClassHostControlService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassHostControlService.class);

    /** Realtime topic for control notifications; see the event protocol doc. */
    static final String CONTROL_TOPIC = "mc.class.control.v1";

    private final OnlineClassRepository classRepository;
    private final OnlineClassParticipantRepository participantRepository;
    private final OnlineClassAccessService accessService;
    private final LiveClassMediaProvider mediaProvider;
    private final Clock clock;

    public OnlineClassHostControlService(OnlineClassRepository classRepository,
                                         OnlineClassParticipantRepository participantRepository,
                                         OnlineClassAccessService accessService,
                                         LiveClassMediaProvider mediaProvider,
                                         Clock clock) {
        this.classRepository = classRepository;
        this.participantRepository = participantRepository;
        this.accessService = accessService;
        this.mediaProvider = mediaProvider;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<ClassParticipantResponse> listParticipants(AuthenticatedUser caller, UUID classId) {
        // Students may see the roster too; only moderation is host-only.
        accessService.requireParticipant(caller, classId);
        return participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(classId).stream()
                .map(ClassParticipantResponse::from)
                .toList();
    }

    /** Attendance summary. Teacher-only: it exposes per-student timings. */
    @Transactional(readOnly = true)
    public List<ClassParticipantResponse> attendance(AuthenticatedUser caller, UUID classId) {
        accessService.requireHost(caller, classId);
        return participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(classId).stream()
                .map(ClassParticipantResponse::from)
                .toList();
    }

    /**
     * Server-side mute of a participant's published audio.
     *
     * <p>This stops the track that is already being published. Browsers cannot be
     * force-<em>un</em>muted, which is why there is no matching unmute here —
     * see {@link #requestUnmute}.
     */
    @Transactional
    public ClassParticipantResponse muteParticipant(AuthenticatedUser caller, UUID classId, UUID userId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        OnlineClassParticipant participant = requireParticipant(classId, userId);
        requireNotSelf(caller, userId, "mute");

        forEachLiveIdentity(onlineClass, userId, identity ->
                mediaProvider.muteParticipantAudio(onlineClass.getRoomName(), identity));
        participant.setMicrophoneEnabled(false);
        log.info("Host muted participant: classId={}", classId);
        return ClassParticipantResponse.from(participant);
    }

    /** Mutes every admitted student, leaving the host untouched. */
    @Transactional
    public List<ClassParticipantResponse> muteAllStudents(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);

        return participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(classId).stream()
                .filter(participant -> !participant.isHost())
                .filter(OnlineClassParticipant::isAdmitted)
                .map(participant -> {
                    try {
                        forEachLiveIdentity(onlineClass, participant.getUser().getId(), identity ->
                                mediaProvider.muteParticipantAudio(onlineClass.getRoomName(), identity));
                    } catch (MediaProviderException e) {
                        // One offline participant must not abort the whole sweep.
                        log.warn("Mute-all skipped a participant: classId={}", classId);
                    }
                    participant.setMicrophoneEnabled(false);
                    return ClassParticipantResponse.from(participant);
                })
                .toList();
    }

    /**
     * Asks a participant to unmute themselves.
     *
     * <p>Deliberately a request, not a command: a browser will not publish audio
     * without local consent, and claiming otherwise would be a lie in the UI.
     */
    @Transactional(readOnly = true)
    public void requestUnmute(AuthenticatedUser caller, UUID classId, UUID userId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        requireParticipant(classId, userId);

        String payload = "{\"type\":\"unmute-request\",\"classId\":\"" + classId
                + "\",\"userId\":\"" + userId + "\",\"version\":1}";
        mediaProvider.sendControlPacket(onlineClass.getRoomName(), CONTROL_TOPIC,
                payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /** Removes a participant; they must not be able to rejoin with a held token. */
    @Transactional
    public ClassParticipantResponse removeParticipant(AuthenticatedUser caller, UUID classId, UUID userId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        OnlineClassParticipant participant = requireParticipant(classId, userId);
        requireNotSelf(caller, userId, "remove");

        participant.remove();
        if (participant.isConnected()) {
            participant.markLeft(clock.instant());
        }
        try {
            // Removes every device/tab that user is connected from.
            forEachLiveIdentity(onlineClass, userId, identity ->
                    mediaProvider.removeParticipant(onlineClass.getRoomName(), identity));
        } catch (MediaProviderException e) {
            // The durable REMOVED state is what blocks a new token, so the
            // removal still holds even if the live disconnect failed.
            log.warn("Participant marked removed but provider disconnect failed: classId={}", classId);
        }
        log.info("Host removed participant: classId={}", classId);
        return ClassParticipantResponse.from(participant);
    }

    /** Updates what one participant may publish. */
    @Transactional
    public ClassParticipantResponse updatePermissions(AuthenticatedUser caller, UUID classId,
                                                      UUID userId, ParticipantPermissionRequest request) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        OnlineClassParticipant participant = requireParticipant(classId, userId);

        if (request.cameraEnabled() != null) {
            participant.setCameraEnabled(request.cameraEnabled());
        }
        if (request.microphoneEnabled() != null) {
            participant.setMicrophoneEnabled(request.microphoneEnabled());
        }
        if (request.screenShareEnabled() != null) {
            participant.setScreenShareEnabled(request.screenShareEnabled());
        }
        applyGrant(onlineClass, participant);
        return ClassParticipantResponse.from(participant);
    }

    /**
     * Turns student screen sharing on or off for the whole class, pushing the
     * new grant to every connected student so it takes effect immediately.
     */
    @Transactional
    public void setStudentScreenShare(AuthenticatedUser caller, UUID classId, boolean enabled) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        onlineClass.setStudentScreenShareEnabled(enabled);
        classRepository.save(onlineClass);

        participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(classId).stream()
                .filter(participant -> !participant.isHost())
                .filter(OnlineClassParticipant::isAdmitted)
                .forEach(participant -> applyGrant(onlineClass, participant));
    }

    @Transactional
    public void setWaitingRoom(AuthenticatedUser caller, UUID classId, boolean enabled) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        onlineClass.setWaitingRoomEnabled(enabled);
        classRepository.save(onlineClass);
    }

    private void applyGrant(OnlineClass onlineClass, OnlineClassParticipant participant) {
        MediaGrant grant = participant.isHost()
                ? MediaGrant.host()
                : new MediaGrant(
                        participant.isCameraEnabled(),
                        participant.isMicrophoneEnabled(),
                        onlineClass.isStudentScreenShareEnabled() && participant.isScreenShareEnabled(),
                        true,
                        true);
        try {
            forEachLiveIdentity(onlineClass, participant.getUser().getId(), identity ->
                    mediaProvider.updatePublishPermissions(onlineClass.getRoomName(), identity, grant));
        } catch (MediaProviderException e) {
            // Durable state is authoritative: the next token reflects it even if
            // the live update could not be delivered.
            log.warn("Permission update stored but not pushed live: classId={}", onlineClass.getId());
        }
    }

    /**
     * Applies an action to every provider identity belonging to a user.
     *
     * <p>A participant identity carries a per-device suffix, so the identity
     * cannot be reconstructed from a user id alone — it has to be resolved from
     * the room. Resolving also means a user connected from two tabs is muted or
     * removed on both rather than only one.
     */
    private void forEachLiveIdentity(OnlineClass onlineClass, UUID userId,
                                     java.util.function.Consumer<String> action) {
        mediaProvider.listParticipantIdentities(onlineClass.getRoomName()).stream()
                .filter(identity -> ParticipantIdentity.userId(identity)
                        .map(userId::equals)
                        .orElse(false))
                .forEach(action);
    }

    private OnlineClassParticipant requireParticipant(UUID classId, UUID userId) {
        return participantRepository.findByOnlineClassIdAndUserId(classId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Participant not found"));
    }

    private void requireNotSelf(AuthenticatedUser caller, UUID userId, String action) {
        if (caller.id().equals(userId)) {
            throw new ConflictException("You cannot " + action + " yourself");
        }
    }
}
