package com.mcschool.flashcard.trialleads.dto;

import com.mcschool.flashcard.trialleads.TrialLead;
import java.time.Instant;
import java.util.UUID;

public record TrialLeadResponse(
        UUID id,
        UUID trackingToken,
        String phone,
        String grade,
        String schoolType,
        String subject,
        String goal,
        String priority,
        String teacherId,
        String teacherName,
        String source,
        String status,
        Instant createdAt,
        Instant updatedAt
) {
    public static TrialLeadResponse from(TrialLead lead) {
        return new TrialLeadResponse(
                lead.getId(),
                lead.getTrackingToken(),
                lead.getPhone(),
                lead.getGrade(),
                lead.getSchoolType(),
                lead.getSubject(),
                lead.getGoal(),
                lead.getPriority(),
                lead.getTeacherId(),
                lead.getTeacherName(),
                lead.getSource(),
                lead.getStatus(),
                lead.getCreatedAt(),
                lead.getUpdatedAt()
        );
    }
}
