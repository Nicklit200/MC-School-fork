package com.mcschool.flashcard.trialbooking;

import java.time.Instant;
import java.util.UUID;

public record TrialBookingResponse(
        UUID teacherId,
        String teacherName,
        Instant startsAt,
        Instant endsAt,
        String eventId,
        String meetUrl
) {}
