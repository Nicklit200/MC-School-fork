package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;
import java.util.UUID;

public record GroupLessonResponse(
        String eventId,
        String bindingKey,
        UUID groupId,
        String groupName,
        UUID studentId,
        String studentName,
        String title,
        Instant startsAt,
        Instant endsAt,
        String meetUrl,
        String calendarUrl
) {
}
