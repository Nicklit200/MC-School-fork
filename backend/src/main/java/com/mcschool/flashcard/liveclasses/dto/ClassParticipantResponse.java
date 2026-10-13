package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.AdmissionState;
import com.mcschool.flashcard.liveclasses.ClassRole;
import com.mcschool.flashcard.liveclasses.OnlineClassParticipant;
import java.time.Instant;
import java.util.UUID;

/**
 * A participant's state. Carries no e-mail: the participant list is visible to
 * other students.
 */
public record ClassParticipantResponse(
        UUID userId,
        String displayName,
        ClassRole classRole,
        AdmissionState admissionState,
        boolean cameraEnabled,
        boolean microphoneEnabled,
        boolean screenShareEnabled,
        boolean connected,
        Instant firstJoinedAt,
        Instant lastLeftAt,
        long totalConnectedSeconds
) {

    public static ClassParticipantResponse from(OnlineClassParticipant source) {
        return new ClassParticipantResponse(
                source.getUser().getId(),
                source.getUser().getFullName(),
                source.getClassRole(),
                source.getAdmissionState(),
                source.isCameraEnabled(),
                source.isMicrophoneEnabled(),
                source.isScreenShareEnabled(),
                source.isConnected(),
                source.getFirstJoinedAt(),
                source.getLastLeftAt(),
                source.getTotalConnectedSeconds());
    }
}
