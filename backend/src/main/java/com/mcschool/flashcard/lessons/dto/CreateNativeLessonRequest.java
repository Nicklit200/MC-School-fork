package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;
import java.util.UUID;

public record CreateNativeLessonRequest(
        String title,
        Instant startsAt,
        Instant endsAt,
        UUID studentId,
        UUID groupId,
        Integer repeatWeeks
) {
}
