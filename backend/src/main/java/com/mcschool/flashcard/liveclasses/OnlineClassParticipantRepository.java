package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassParticipantRepository
        extends JpaRepository<OnlineClassParticipant, UUID> {

    Optional<OnlineClassParticipant> findByOnlineClassIdAndUserId(UUID classId, UUID userId);

    List<OnlineClassParticipant> findAllByOnlineClassIdOrderByCreatedAtAsc(UUID classId);

    List<OnlineClassParticipant> findAllByOnlineClassIdAndAdmissionState(
            UUID classId, AdmissionState admissionState);
}
