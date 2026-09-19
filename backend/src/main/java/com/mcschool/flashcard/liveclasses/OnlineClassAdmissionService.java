package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.JoinRequestResponse;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Waiting room: knocking, and the teacher's admit/reject decisions.
 *
 * <p>Knocking is idempotent — a student who refreshes, reconnects or double-taps
 * keeps the one pending request they already have, which is also enforced by a
 * partial unique index.
 */
@Service
public class OnlineClassAdmissionService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassAdmissionService.class);

    private final OnlineClassJoinRequestRepository joinRequestRepository;
    private final OnlineClassParticipantRepository participantRepository;
    private final OnlineClassAccessService accessService;
    private final Clock clock;

    public OnlineClassAdmissionService(OnlineClassJoinRequestRepository joinRequestRepository,
                                       OnlineClassParticipantRepository participantRepository,
                                       OnlineClassAccessService accessService,
                                       Clock clock) {
        this.joinRequestRepository = joinRequestRepository;
        this.participantRepository = participantRepository;
        this.accessService = accessService;
        this.clock = clock;
    }

    /**
     * Requests entry. Returns the existing pending request when one is already
     * open, so the waiting state survives a refresh.
     */
    @Transactional
    public JoinRequestResponse knock(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        if (!onlineClass.isConnectable()) {
            throw new ConflictException("This class is not open");
        }

        User user = accessService.requireActiveUser(caller.id());
        OnlineClassParticipant participant = participantRepository
                .findByOnlineClassIdAndUserId(classId, caller.id())
                .orElseGet(() -> participantRepository.save(
                        accessService.isHost(caller, onlineClass)
                                ? OnlineClassParticipant.host(onlineClass, user)
                                : OnlineClassParticipant.student(onlineClass, user)));

        // A removed participant may not knock again; only the teacher can undo
        // a removal, by re-admitting them explicitly.
        if (participant.getAdmissionState() == AdmissionState.REMOVED) {
            throw new ConflictException("You have been removed from this class");
        }

        return joinRequestRepository
                .findByOnlineClassIdAndUserIdAndState(classId, caller.id(), JoinRequestState.PENDING)
                .map(JoinRequestResponse::from)
                .orElseGet(() -> {
                    OnlineClassJoinRequest request = OnlineClassJoinRequest.knock(onlineClass, user, now());
                    // Without a waiting room the request is created already
                    // approved, so the client has one consistent shape to read.
                    if (!onlineClass.isWaitingRoomEnabled() || participant.isHost()) {
                        request.approve(user, now());
                        participant.admit();
                    }
                    return JoinRequestResponse.from(joinRequestRepository.save(request));
                });
    }

    @Transactional(readOnly = true)
    public List<JoinRequestResponse> listPending(AuthenticatedUser caller, UUID classId) {
        accessService.requireHost(caller, classId);
        return joinRequestRepository
                .findAllByOnlineClassIdAndStateOrderByRequestedAtAsc(classId, JoinRequestState.PENDING)
                .stream()
                .map(JoinRequestResponse::from)
                .toList();
    }

    @Transactional
    public JoinRequestResponse approve(AuthenticatedUser caller, UUID classId, UUID requestId) {
        return decide(caller, classId, requestId, true);
    }

    @Transactional
    public JoinRequestResponse reject(AuthenticatedUser caller, UUID classId, UUID requestId) {
        return decide(caller, classId, requestId, false);
    }

    /** Admits everyone currently waiting, in one transaction. */
    @Transactional
    public List<JoinRequestResponse> approveAll(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        User decider = accessService.requireActiveUser(caller.id());

        return joinRequestRepository
                .findAllByOnlineClassIdAndStateOrderByRequestedAtAsc(classId, JoinRequestState.PENDING)
                .stream()
                .map(request -> {
                    request.approve(decider, now());
                    applyDecision(onlineClass, request, true);
                    return JoinRequestResponse.from(request);
                })
                .toList();
    }

    private JoinRequestResponse decide(AuthenticatedUser caller, UUID classId,
                                       UUID requestId, boolean approved) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        OnlineClassJoinRequest request = joinRequestRepository
                .findByIdAndOnlineClassId(requestId, classId)
                .orElseThrow(() -> new ResourceNotFoundException("Join request not found"));

        // Deciding twice is rejected rather than silently overwritten, so a
        // duplicate click cannot flip a rejection into an approval.
        if (!request.isPending()) {
            throw new ConflictException("This request has already been decided");
        }

        User decider = accessService.requireActiveUser(caller.id());
        if (approved) {
            request.approve(decider, now());
        } else {
            request.reject(decider, now());
        }
        applyDecision(onlineClass, request, approved);

        log.info("Join request decided: classId={} approved={}", classId, approved);
        return JoinRequestResponse.from(request);
    }

    private void applyDecision(OnlineClass onlineClass, OnlineClassJoinRequest request, boolean approved) {
        OnlineClassParticipant participant = participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), request.getUser().getId())
                .orElseGet(() -> participantRepository.save(
                        OnlineClassParticipant.student(onlineClass, request.getUser())));
        if (approved) {
            participant.admit();
        } else {
            participant.reject();
        }
    }

    private Instant now() {
        return clock.instant();
    }
}
