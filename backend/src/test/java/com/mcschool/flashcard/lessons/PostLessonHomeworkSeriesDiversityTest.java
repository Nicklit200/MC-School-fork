package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PostLessonHomeworkSeriesDiversityTest {
    private static Map<String,Object> task(String expression) {
        return Map.of("expression",expression,"title","Find the zero");
    }

    private static Map<String,Object> day(int number,String... expressions) {
        return Map.of("day",number,"tasks",java.util.Arrays.stream(expressions)
                .map(PostLessonHomeworkSeriesDiversityTest::task).toList());
    }

    private static Map<String,Object> content(String... expressions) {
        return Map.of("tasks",java.util.Arrays.stream(expressions)
                .map(PostLessonHomeworkSeriesDiversityTest::task).toList());
    }

    @Test void rejectsExactDuplicateAcrossTwoDaysDespiteDifferentTitles() {
        var previous=List.of(day(4,"2*x-8=0","3*x+6=0"));
        var error=assertThrows(IllegalArgumentException.class,()->
                PostLessonHomeworkSeriesDiversity.validate(content("2*x-8=0","3*x+6=0"),previous,5));
        assertEquals(PostLessonHomeworkSeriesDiversity.REPEATED_EXPRESSION,error.getMessage());
    }

    @Test void actualSonjaRegressionDetectsDaySixDuplicateOfDayThree() {
        var previous=List.of(day(1,"x-3=0","x+4=0"),
                day(2,"3*x-7=8","2*x-10=0"),
                day(3,"2*x-6=0","3*x+9=0"),
                day(4,"2*x-8=0","3*x+6=0"),
                day(5,"2*x-8=0","3*x+6=0"));
        assertThrows(IllegalArgumentException.class,()->
                PostLessonHomeworkSeriesDiversity.validate(content("2*x-6=0","3*x+6=0"),previous,6));
    }

    @Test void ignoresWhitespaceUnicodeMinusAndFlippedZeroEquation() {
        var prior=List.of(day(1,"2 * x − 6 = 0"));
        var error=assertThrows(IllegalArgumentException.class,()->
                PostLessonHomeworkSeriesDiversity.validate(content("0=2*x-6"),prior,2));
        assertEquals(PostLessonHomeworkSeriesDiversity.REPEATED_EXPRESSION,error.getMessage());
    }

    @Test void rejectsDuplicateProblemsWithinOneDay() {
        var error=assertThrows(IllegalArgumentException.class,()->
                PostLessonHomeworkSeriesDiversity.validate(content("3*x+9=0"," 3 * x + 9 = 0 "),List.of(),1));
        assertEquals(PostLessonHomeworkSeriesDiversity.REPEATED_EXPRESSION,error.getMessage());
    }

    @Test void threeConsecutiveDaysOfTrivialOneStepZerosAreNotAWeekPlan() {
        var prior=List.of(day(1,"x-3=0","x+4=0"),day(2,"2*x-6=0","3*x+9=0"));
        var error=assertThrows(IllegalArgumentException.class,()->
                PostLessonHomeworkSeriesDiversity.validate(content("3*x-12=0","2*x+8=0"),prior,3));
        assertEquals(PostLessonHomeworkSeriesDiversity.REPEATED_PATTERN,error.getMessage());
    }

    @Test void numericalVerificationBreaksMonotonousZeroPatternWithoutNewTopic() {
        var prior=List.of(day(1,"x-3=0","x+4=0"),day(2,"2*x-6=0","3*x+9=0"));
        assertDoesNotThrow(()->PostLessonHomeworkSeriesDiversity.validate(
                content("2*3-6","4*x+12=0"),prior,3));
    }

    @Test void sameSkillWithNewNumbersIsFineOnSecondDay() {
        var prior=List.of(day(1,"x-3=0","x+4=0"));
        assertDoesNotThrow(()->PostLessonHomeworkSeriesDiversity.validate(
                content("2*x-8=0","3*x+6=0"),prior,2));
    }

    @Test void onlyConsidersSameStudentAndCurrentJobHistoryPassedByWorker() {
        // The worker passes only the same job + pupil. Empty history must not
        // accidentally be compared to an unrelated student's mathematics.
        assertDoesNotThrow(()->PostLessonHomeworkSeriesDiversity.validate(
                content("2*x-6=0","3*x+9=0"),List.of(),1));
    }

    @Test void omittedOldHistoryIsSafeButDoesNotFabricateLessons() {
        assertDoesNotThrow(()->PostLessonHomeworkSeriesDiversity.validate(
                content("2*x-6=0"),null,3));
    }
}
