package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record GroupLessonResponse(
        String eventId,
        String bindingKey,
        UUID groupId,
        String groupName,
        UUID studentId,
        String studentName,
        List<UUID> participantStudentIds,
        String title,
        Instant startsAt,
        Instant endsAt,
        String meetUrl,
        String calendarUrl
) {
}
