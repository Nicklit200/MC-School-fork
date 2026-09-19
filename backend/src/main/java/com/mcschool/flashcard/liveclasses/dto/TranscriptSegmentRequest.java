package com.mcschool.flashcard.liveclasses.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * One final transcript segment submitted by the transcription worker.
 *
 * @param providerSegmentId ingestion idempotency key — a resend after a worker
 *                          reconnect must collapse onto the existing row
 */
public record TranscriptSegmentRequest(
        @NotBlank @Size(max = 255) String providerSegmentId,
        @Size(max = 255) String participantIdentity,
        @Size(max = 120) String speakerLabel,
        @Size(max = 20) String language,
        @PositiveOrZero long startMs,
        @PositiveOrZero long endMs,
        @Size(max = 5000) String text,
        Double confidence
) {
}
