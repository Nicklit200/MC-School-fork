package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.OnlineClassRecording;
import com.mcschool.flashcard.liveclasses.RecordingStatus;
import java.time.Instant;
import java.util.UUID;

/**
 * A recording artifact.
 *
 * @param downloadUrl short-lived signed URL, present only when the caller is
 *                    authorized and the recording is ready. It is a credential:
 *                    never log or persist it.
 */
public record RecordingResponse(
        UUID id,
        RecordingStatus status,
        Instant requestedAt,
        Instant startedAt,
        Instant endedAt,
        Long byteSize,
        Long durationSeconds,
        String failureReason,
        Instant deleteAfter,
        String downloadUrl
) {

    public static RecordingResponse from(OnlineClassRecording source, String downloadUrl) {
        return new RecordingResponse(
                source.getId(),
                source.getStatus(),
                source.getRequestedAt(),
                source.getStartedAt(),
                source.getEndedAt(),
                source.getByteSize(),
                source.getDurationSeconds(),
                source.getFailureReason(),
                source.getDeleteAfter(),
                downloadUrl);
    }
}
