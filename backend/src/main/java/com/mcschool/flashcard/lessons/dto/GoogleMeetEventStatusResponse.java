package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;

public record GoogleMeetEventStatusResponse(
        boolean configured,
        boolean subscribed,
        Instant lastLeftAt
) {
}
