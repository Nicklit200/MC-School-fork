package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;
import java.util.UUID;

public record GroupLessonResponse(
        String eventId,
        UUID groupId,
        String groupName,
        String title,
        Instant startsAt,
        Instant endsAt,
        String meetUrl,
        String calendarUrl
) {
}
