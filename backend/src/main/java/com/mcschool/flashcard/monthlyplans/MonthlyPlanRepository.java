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
}
