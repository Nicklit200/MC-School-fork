package com.mcschool.flashcard.monthlyplans.dto;

import com.mcschool.flashcard.monthlyplans.MonthlyPlan;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanTargetType;
import java.time.Instant;
import java.util.UUID;

public record MonthlyPlanResponse(
        UUID id,
        String targetType,
        UUID targetId,
        String month,
        String planJson,
        long version,
        Instant updatedAt
) {
    public static MonthlyPlanResponse from(MonthlyPlan plan) {
        return new MonthlyPlanResponse(
                plan.getId(),
                plan.getTargetType().name(),
                plan.getTargetId(),
                plan.getPlanMonth(),
                plan.getPlanJson(),
                plan.getVersion() == null ? 0L : plan.getVersion(),
                plan.getUpdatedAt());
    }

    public static MonthlyPlanResponse empty(MonthlyPlanTargetType targetType, UUID targetId, String month) {
        return new MonthlyPlanResponse(null, targetType.name(), targetId, month, "", 0L, null);
    }
}
