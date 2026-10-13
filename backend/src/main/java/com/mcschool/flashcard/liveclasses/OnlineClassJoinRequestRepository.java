package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassJoinRequestRepository
        extends JpaRepository<OnlineClassJoinRequest, UUID> {

    /** At most one may exist, enforced by a partial unique index. */
    Optional<OnlineClassJoinRequest> findByOnlineClassIdAndUserIdAndState(
            UUID classId, UUID userId, JoinRequestState state);

    List<OnlineClassJoinRequest> findAllByOnlineClassIdAndStateOrderByRequestedAtAsc(
            UUID classId, JoinRequestState state);

    Optional<OnlineClassJoinRequest> findByIdAndOnlineClassId(UUID id, UUID classId);
}
