package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.skills.SkillBoardService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PostLessonSkillReviewTest {
    private static SkillBoardService.Node allowed() {
        return new SkillBoardService.Node("skill-fractions","skill","Дроби",
                "Brüche","Сложение дробей","1/4+1/6","Math 6",
                "blue",0,0,false);
    }

    private static Map<String,Object> proposal(String skillId,int confidence,int examples) {
        return Map.of(
                "skillId",skillId,
                "autonomy","INDEPENDENT",
                "correctness","CORRECT",
                "origin","WRITING",
                "correctExamples",examples,
                "confidence",confidence,
                "explanation","Ученик самостоятельно правильно привёл две дроби к общему знаменателю",
                "excerpt","Страница 4: 1/4 + 1/6 = 5/12");
    }

    @Test
    void modelCannotInventSkillIdsOrReturnConfidentScoresWithoutEvidence() {
        var result=PostLessonSkillAnalysisService.validate(
                Map.of("observations",List.of(
                        proposal("invented-skill",99,5),
                        proposal("skill-fractions",92,2),
                        proposal("skill-fractions",99,2))),
                List.of(allowed()));
        assertThat(result).hasSize(1);
        assertThat(result.get(0).skillId()).isEqualTo("skill-fractions");
        assertThat(result.get(0).confidence()).isEqualTo(92);
    }

    @Test
    void illegibleOrUnattributedWritingCannotBePresentedAsEvidence() {
        var invalid=new java.util.HashMap<String,Object>(proposal("skill-fractions",99,2));
        invalid.put("excerpt","??");
        var dubious=new java.util.HashMap<String,Object>(proposal("skill-fractions",80,2));
        var hallucination=new java.util.HashMap<String,Object>(proposal("skill-fractions",99,2));
        hallucination.put("correctness","UNCERTAIN");
        assertThat(PostLessonSkillAnalysisService.validate(
                Map.of("observations",List.of(invalid,dubious,hallucination)),List.of(allowed())))
                .isEmpty();
    }

    @Test
    void teacherCannotGetAutomaticMasteryFromAnUntouchedExerciseOrSingleAnswer() {
        var verified=new PostLessonSkillAnalysisService.Observation(
                "skill-fractions","INDEPENDENT","CORRECT","WRITING",2,98,
                "Two independently solved equations","Page 4: 1/4 + 1/6 = 5/12");
        assertThat(PostLessonSkillReviewService.masteryAfter(null,verified)).isEqualTo(60);
        assertThat(PostLessonSkillReviewService.masteryAfter(50,verified)).isEqualTo(55);
        assertThat(PostLessonSkillReviewService.masteryAfter(98,verified)).isEqualTo(98);
        assertThat(PostLessonSkillReviewService.masteryAfter(100,verified)).isEqualTo(100);
        assertThat(PostLessonSkillReviewService.masteryAfter(50,
                new PostLessonSkillAnalysisService.Observation("skill-fractions",
                    "HINTED","CORRECT","WRITING",2,99,"Teacher explained first",
                    "page 4: first solution with help"))).isNull();
        assertThat(PostLessonSkillReviewService.masteryAfter(50,
                new PostLessonSkillAnalysisService.Observation("skill-fractions",
                    "INDEPENDENT","CORRECT","WRITING",1,99,"One answer only",
                    "page 4: one correct solution"))).isNull();
        assertThat(PostLessonSkillReviewService.masteryAfter(50,
                new PostLessonSkillAnalysisService.Observation("skill-fractions",
                    "INDEPENDENT","INCORRECT","WRITING",2,99,"Wrong answers",
                    "page 4: denominator error"))).isNull();
    }

    @Test
    void lowCertaintyAndNonSkillCatalogNodesAreRejected() {
        var topic=new SkillBoardService.Node("topic-fractions","topic","Brüche","Brüche",
                "chapter","","","orange",0,0,false);
        var archived=new SkillBoardService.Node("skill-fractions","skill","Brüche","Brüche",
                "archived","","","orange",0,0,true);
        assertThat(PostLessonSkillAnalysisService.validate(Map.of("observations",
                List.of(proposal("topic-fractions",99,4),proposal("skill-fractions",99,4))),
                List.of(topic,archived))).isEmpty();
    }
}
