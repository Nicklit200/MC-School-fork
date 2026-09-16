package com.mcschool.flashcard.parents;

import java.util.List;
import java.util.UUID;

public record ParentChildStatusResponse(
        UUID studentId,
        String studentName,
        long homeworkAssignedToday,
        long homeworkCompletedToday,
        long homeworkOpenToday,
        long cardsDueToday,
        List<ParentHomeworkStatusResponse> homeworks
) {}
