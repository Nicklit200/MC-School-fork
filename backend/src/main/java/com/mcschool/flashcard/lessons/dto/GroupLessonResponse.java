package com.mcschool.flashcard.lessons.dto;

import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
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
        String calendarUrl,
        OnlineClassStatus onlineClassStatus,
        Instant actualStartAt,
        Instant actualEndAt
) {
    /** Schedule-only callers do not imply that the lesson was actually started. */
    public GroupLessonResponse(String eventId, String bindingKey, UUID groupId, String groupName,
                               UUID studentId, String studentName, List<UUID> participantStudentIds,
                               String title, Instant startsAt, Instant endsAt,
                               String meetUrl, String calendarUrl) {
        this(eventId, bindingKey, groupId, groupName, studentId, studentName, participantStudentIds,
                title, startsAt, endsAt, meetUrl, calendarUrl, null, null, null);
    }

    public GroupLessonResponse withExecution(OnlineClassStatus status, Instant actualStart, Instant actualEnd) {
        return new GroupLessonResponse(eventId, bindingKey, groupId, groupName, studentId, studentName,
                participantStudentIds, title, startsAt, endsAt, meetUrl, calendarUrl,
                status, actualStart, actualEnd);
    }
}
