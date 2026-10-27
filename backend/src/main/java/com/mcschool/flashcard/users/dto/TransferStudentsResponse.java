package com.mcschool.flashcard.users.dto;

import java.util.UUID;

public record TransferStudentsResponse(
        UUID fromTeacherId,
        String fromTeacherName,
        UUID toTeacherId,
        String toTeacherName,
        int transferredStudents,
        int transferredGroups,
        int copiedFutureLessons,
        int groupsWithLessonsNotTransferred
) {}
