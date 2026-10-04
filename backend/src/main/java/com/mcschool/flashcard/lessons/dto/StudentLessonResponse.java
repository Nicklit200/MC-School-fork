package com.mcschool.flashcard.lessons.dto;

import java.time.Instant;

public record StudentLessonResponse(
        String eventId,
        String title,
        String groupName,
        Instant startsAt,
        Instant endsAt,
        String meetUrl,
        boolean hasSharedDocument,
        String sharedDocumentFilename
) {
}
