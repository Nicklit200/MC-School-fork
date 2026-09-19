package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.OnlineClassTranscriptSegment;
import java.util.UUID;

/** A stored transcript segment. */
public record TranscriptSegmentResponse(
        UUID id,
        String speakerLabel,
        UUID userId,
        String language,
        long startMs,
        long endMs,
        String text,
        Double confidence
) {

    public static TranscriptSegmentResponse from(OnlineClassTranscriptSegment source) {
        return new TranscriptSegmentResponse(
                source.getId(),
                source.getSpeakerLabel(),
                source.getUser() == null ? null : source.getUser().getId(),
                source.getLanguage(),
                source.getStartMs(),
                source.getEndMs(),
                source.getText(),
                source.getConfidence());
    }
}
