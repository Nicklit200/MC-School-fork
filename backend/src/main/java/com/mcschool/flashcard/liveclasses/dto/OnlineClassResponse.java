package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.ClassFeatureState;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
import com.mcschool.flashcard.liveclasses.LessonEntryPolicy;
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
        boolean joinWindowOpen,
        /** Whether this server can record at all (provider and storage configured). */
        boolean recordingAvailable,
        /** Whether this server can transcribe at all. */
        boolean transcriptionAvailable,
        String entryState,
        java.time.LocalDate entryDate,
        Instant entryOpensAt,
        Instant entryClosesAt,
        boolean viewerHasJoined,
        Instant serverNow,
        /** Physical media presence is separate from a lesson remaining available. */
        String mediaState,
        /** A current provider snapshot confirmed this room's owning teacher. */
        boolean teacherPresent
) {

    public static OnlineClassResponse from(OnlineClass source, boolean viewerIsHost, boolean joinWindowOpen,
                                           boolean recordingAvailable, boolean transcriptionAvailable) {
        return from(source, viewerIsHost, joinWindowOpen, recordingAvailable, transcriptionAvailable,
                source.isTerminal() ? "ENDED" : joinWindowOpen ? "OPEN" : "WAITING_FOR_TEACHER", false, Instant.now());
    }

    public static OnlineClassResponse from(OnlineClass source, boolean viewerIsHost, boolean joinWindowOpen,
                                           boolean recordingAvailable, boolean transcriptionAvailable,
                                           String entryState, boolean viewerHasJoined, Instant serverNow) {
        return from(source, viewerIsHost, joinWindowOpen, recordingAvailable, transcriptionAvailable,
                entryState, viewerHasJoined, serverNow, false);
    }

    public static OnlineClassResponse from(OnlineClass source, boolean viewerIsHost, boolean joinWindowOpen,
                                           boolean recordingAvailable, boolean transcriptionAvailable,
                                           String entryState, boolean viewerHasJoined, Instant serverNow, boolean teacherPresent) {
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
                joinWindowOpen,
                recordingAvailable,
                transcriptionAvailable, entryState,
                LessonEntryPolicy.lessonDate(source.getScheduledStartAt()),
                LessonEntryPolicy.dayStart(source.getScheduledStartAt()),
                LessonEntryPolicy.dayEnd(source.getScheduledStartAt()), viewerHasJoined, serverNow,
                source.isTerminal() ? "ENDED" : source.getStatus() != OnlineClassStatus.LIVE
                        || source.getEmptySince() != null ? "IDLE" : "ACTIVE", teacherPresent);
    }
}
