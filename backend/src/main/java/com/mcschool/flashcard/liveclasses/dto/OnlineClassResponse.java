package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.ClassFeatureState;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
import java.time.Instant;
import java.util.UUID;

/**
 * Class state for an authorized viewer.
 *
 * <p>Carries no provider URL, token or credential: connecting is a separate,
 * separately authorized call.
 */
public record OnlineClassResponse(
        UUID id,
        String eventId,
        String bindingKey,
        String title,
        Instant scheduledStartAt,
        Instant scheduledEndAt,
        UUID studentId,
        UUID groupId,
        OnlineClassStatus status,
        boolean waitingRoomEnabled,
        boolean studentScreenShareEnabled,
        ClassFeatureState recordingState,
        ClassFeatureState transcriptionState,
        Instant actualStartAt,
        Instant actualEndAt,
        boolean viewerIsHost,
        boolean joinWindowOpen
) {

    public static OnlineClassResponse from(OnlineClass source, boolean viewerIsHost, boolean joinWindowOpen) {
        return new OnlineClassResponse(
                source.getId(),
                source.getEventId(),
                source.getBindingKey(),
                source.getTitle(),
                source.getScheduledStartAt(),
                source.getScheduledEndAt(),
                source.getStudent() == null ? null : source.getStudent().getId(),
                source.getGroup() == null ? null : source.getGroup().getId(),
                source.getStatus(),
                source.isWaitingRoomEnabled(),
                source.isStudentScreenShareEnabled(),
                source.getRecordingState(),
                source.getTranscriptionState(),
                source.getActualStartAt(),
                source.getActualEndAt(),
                viewerIsHost,
                joinWindowOpen);
    }
}
