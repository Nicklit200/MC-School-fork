package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.AttendanceStatus;
import java.time.Instant;
import java.util.UUID;

public record AttendanceStudentResponse(
        UUID studentId,
        String studentName,
        AttendanceStatus status,
        boolean joined,
        Instant firstJoinedAt,
        long connectedSeconds
) {
}
