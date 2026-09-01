package com.mcschool.flashcard.groups.dto;

import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.UserResponse;
import java.util.List;
import java.util.UUID;

public record StudentGroupResponse(
        UUID id,
        String name,
        List<UserResponse> students
) {
    public static StudentGroupResponse from(StudentGroup group, List<UserResponse> students) {
        return new StudentGroupResponse(group.getId(), group.getName(), students);
    }
}
