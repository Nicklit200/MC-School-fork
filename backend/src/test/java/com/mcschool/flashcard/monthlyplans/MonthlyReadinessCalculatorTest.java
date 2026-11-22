package com.mcschool.flashcard.monthlyplans;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MonthlyReadinessCalculatorTest {
    @Test void excludesUnknownSkillsFromScoreButShowsCoverage() {
        var result = MonthlyReadinessCalculator.calculate(
                List.of("a", "b", "c"), List.of("Unmapped syllabus topic"),
                Map.of("a",80,"c",40));
        assertEquals(60,result.percent());
        assertEquals(2,result.assessed());
        assertEquals(3,result.total());
        assertEquals(67,result.assessedCoverage());
        assertEquals(1,result.unmappedCount());
    }

    @Test void anExplicitZeroIsNotTreatedAsMissing() {
        var result = MonthlyReadinessCalculator.calculate(
                List.of("a","b"), List.of(), Map.of("a",0,"b",100));
        assertEquals(50,result.percent());
        assertEquals(2,result.assessed());
    }

    @Test void missingAllMasteryIsNotFabricatedAsZeroPercent() {
        var result = MonthlyReadinessCalculator.calculate(
                List.of("a","b"),List.of(),Map.of());
        assertNull(result.percent());
        assertEquals(0,result.assessedCoverage());
    }

    @Test void recalculatesAfterTranscriptUpdatesUnderlyingSkill() {
        var oldScore=MonthlyReadinessCalculator.calculate(
                List.of("a","b"),List.of(),Map.of("a",20,"b",40));
        var newScore=MonthlyReadinessCalculator.calculate(
                List.of("a","b"),List.of(),Map.of("a",70,"b",90));
        assertEquals(30,oldScore.percent());
        assertEquals(80,newScore.percent());
    }

    @Test void duplicateLinksAreCountedOnce() {
        var result=MonthlyReadinessCalculator.calculate(
                List.of("a","a","b"),List.of(),Map.of("a",80,"b",60));
        assertEquals(70,result.percent());
        assertEquals(2,result.total());
    }
}
