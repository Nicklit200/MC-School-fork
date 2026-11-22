package com.mcschool.flashcard.monthlyplans;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Derived assessment, never stored as a second copy of student skill mastery. */
public final class MonthlyReadinessCalculator {
    private MonthlyReadinessCalculator() {}

    public record Readiness(Integer percent, int assessed, int total,
                            int assessedCoverage, int unmappedCount) {}

    public static Readiness calculate(List<String> skillIds,
                                      List<String> unmappedTopics,
                                      Map<String,Integer> mastery) {
        Set<String> ids = new LinkedHashSet<>();
        if (skillIds != null) for (String id : skillIds) {
            if (id != null && !id.isBlank()) ids.add(id);
        }
        int total = ids.size();
        int assessed = 0;
        int sum = 0;
        if (mastery != null) for (String skillId : ids) {
            Integer value = mastery.get(skillId);
            if (value != null && value >= 0 && value <= 100) {
                sum += value;
                assessed++;
            }
        }
        return new Readiness(
                assessed == 0 ? null : Math.round((float) sum / assessed),
                assessed, total,
                total == 0 ? 0 : Math.round(assessed * 100f / total),
                unmappedTopics == null ? 0 : unmappedTopics.size());
    }
}
