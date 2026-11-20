package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Includes the cached-selection path used by a retry of an existing failed job. */
class PostLessonHomeworkRecipientGuardTest {
    private static final String SONJA = "00000000-0000-4000-a000-000000001001";
    private static final String MELISSA = "00000000-0000-4000-a000-000000001002";
    private static final List<Map<String,Object>> SOLO =
            List.of(Map.of("id",SONJA,"name","Соня"));
    private static final List<Map<String,Object>> GROUP =
            List.of(Map.of("id",SONJA,"name","Соня"),
                    Map.of("id",MELISSA,"name","Мелисса"));

    private static Map<String,Object> selection(String studentId,String quote) {
        return Map.of("excluded", List.of(Map.of("studentId",studentId,"quote",quote)),
                "personalNotes", List.of(Map.of("studentId",studentId,"note","Fractions")));
    }

    private static List<?> excluded(Map<String,Object> result) {
        return (List<?>)result.get("excluded");
    }

    @Test void pupilWasAbsentDoesNotMeanNoHomework() {
        String notes="Соня отсутствовала на уроке, но задай ей домашнее задание на семь дней.";
        var guarded=PostLessonHomeworkRecipientGuard.verify(SOLO,notes,
                selection(SONJA,"Соня отсутствовала на уроке"));
        assertTrue(excluded(guarded).isEmpty());
        assertEquals(1,((List<?>)guarded.get("personalNotes")).size());
    }

    @Test void cachedSelectionWithOnlyPupilIncorrectlyExcludedIsRecovered() {
        String notes="Соня не делала домашку, надо повторить дроби и задания из урока.";
        var guarded=PostLessonHomeworkRecipientGuard.verify(SOLO,notes,
                selection(SONJA,"Соня не делала домашку"));
        assertTrue(excluded(guarded).isEmpty());
    }

    @Test void aQuoteWithOnlyTheNameIsNotAReasonToExclude() {
        String notes="Соня: нужно повторить десятичные дроби.";
        assertTrue(excluded(PostLessonHomeworkRecipientGuard.verify(SOLO,notes,
                selection(SONJA,"Соня"))).isEmpty());
    }

    @Test void explicitRussianExclusionStillTakesEffect() {
        String notes="Соне не задавай домашку, она уже получила задания отдельно.";
        assertEquals(1,excluded(PostLessonHomeworkRecipientGuard.verify(SOLO,notes,
                selection(SONJA,"Соне не задавай домашку"))).size());
    }

    @Test void aGeneralExplicitSkipIsRespected() {
        String notes="Сегодня никому домашку не задавать.";
        assertEquals(1,excluded(PostLessonHomeworkRecipientGuard.verify(SOLO,notes,
                selection(SONJA,"домашку не задавать"))).size());
    }

    @Test void explicitGermanInstructionIsRespected() {
        String notes="Melissa: keine Hausaufgaben; Sonja: Brüche üben.";
        assertEquals(1,excluded(PostLessonHomeworkRecipientGuard.verify(GROUP,notes,
                selection(MELISSA,"keine Hausaufgaben"))).size());
    }

    @Test void quoteNamingAnotherPupilCannotExcludeTheWrongOne() {
        String notes="Мелиссе не задавай домашку. Соне подготовь задания.";
        assertTrue(excluded(PostLessonHomeworkRecipientGuard.verify(GROUP,notes,
                selection(SONJA,"Мелиссе не задавай домашку"))).isEmpty());
    }

    @Test void correctlyTargetedGroupExclusionIsKept() {
        String notes="Мелиссе не задавай домашку. Соне подготовь задания.";
        assertEquals(1,excluded(PostLessonHomeworkRecipientGuard.verify(GROUP,notes,
                selection(MELISSA,"Мелиссе не задавай домашку"))).size());
    }

    @Test void madeUpQuoteCannotExcludeAStudent() {
        String notes="Соне задай задания на неделю.";
        assertTrue(excluded(PostLessonHomeworkRecipientGuard.verify(SOLO,notes,
                selection(SONJA,"Соне не задавай домашку"))).isEmpty());
    }
}
