package com.mcschool.flashcard.monthlyplans;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MonthlyPlanRepository extends JpaRepository<MonthlyPlan, UUID> {
    Optional<MonthlyPlan> findByTeacherIdAndTargetTypeAndTargetIdAndPlanMonth(
            UUID teacherId,
            MonthlyPlanTargetType targetType,
            UUID targetId,
            String planMonth);
    java.util.List<MonthlyPlan> findByTeacherIdAndTargetTypeAndTargetIdAndPlanMonthBetween(
            UUID teacherId,
            MonthlyPlanTargetType targetType,
            UUID targetId,
            String firstMonth,
            String lastMonth);
}
