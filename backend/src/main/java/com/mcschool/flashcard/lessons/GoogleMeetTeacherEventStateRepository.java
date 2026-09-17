package com.mcschool.flashcard.lessons;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GoogleMeetTeacherEventStateRepository extends JpaRepository<GoogleMeetTeacherEventState, UUID> {
    Optional<GoogleMeetTeacherEventState> findByWorkspaceSubscriptionName(String workspaceSubscriptionName);
}
