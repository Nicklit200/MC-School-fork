package com.mcschool.flashcard.trialleads;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TrialLeadRepository extends JpaRepository<TrialLead, UUID> {
    Optional<TrialLead> findByTrackingToken(UUID trackingToken);
    List<TrialLead> findAllByOrderByCreatedAtDesc();
}
