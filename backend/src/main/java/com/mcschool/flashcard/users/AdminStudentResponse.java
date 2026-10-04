package com.mcschool.flashcard.users;

import java.util.UUID;

public record AdminStudentResponse(
        UUID id,
        String fullName,
        String username,
        UserStatus status,
        Integer grade,
        String schoolType,
        String learningPace,
        String learningStrengths,
        String learningDifficulties,
        String explanationStyle,
        String learningNotes,
        UUID teacherId,
        String teacherName,
        UUID parentId,
        String parentName
) {
    public static AdminStudentResponse from(User student) {
        User teacher = student.getTeacher();
        User parent = student.getParent();
        return new AdminStudentResponse(
                student.getId(),
                student.getFullName(),
                student.getUsername(),
                student.getStatus(),
                student.getGrade(),
                student.getSchoolType(),
                student.getLearningPace(),
                student.getLearningStrengths(),
                student.getLearningDifficulties(),
                student.getExplanationStyle(),
                student.getLearningNotes(),
                teacher == null ? null : teacher.getId(),
                teacher == null ? null : teacher.getFullName(),
                parent == null ? null : parent.getId(),
                parent == null ? null : parent.getFullName()
        );
    }
}
