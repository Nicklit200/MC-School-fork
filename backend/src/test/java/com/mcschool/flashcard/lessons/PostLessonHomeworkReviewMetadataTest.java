package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PostLessonHomeworkReviewMetadataTest {
    private static final Map<String,Object> TASK=Map.of("title","Brüche addieren",
        "description","Berechne den Wert","expression","1/2+1/4","answer","3/4");
    private static final Map<String,Object> CONTENT=Map.of("topic","Brüche",
        "subtitle","Addition gleichnamiger Brüche","tasks",List.of(TASK));

    @Test void containsTopicExercisesAndReasonButNeverAnswer() {
        var result=PostLessonHomeworkReviewMetadata.build(CONTENT,Map.of("teacherNotes","Rechnen mit Brüchen"));
        assertEquals("Brüche",result.get("topic"));
        assertTrue(((String)result.get("why")).contains("Rechnen mit Brüchen"));
        assertEquals("TEACHER",result.get("reasonSource"));
        assertEquals(1,((List<?>)result.get("tasks")).size());
        assertFalse(result.toString().contains("3/4"));
    }

    @Test void studentSpecificInstructionsTakePrecedenceOverGeneralNotes() {
        var result=PostLessonHomeworkReviewMetadata.build(CONTENT,
                Map.of("teacherNotes","allgemein","personalTeacherNotes","Nur die ersten Aufgaben"));
        assertTrue(((String)result.get("why")).contains("Nur die ersten Aufgaben"));
        assertFalse(((String)result.get("why")).contains("allgemein"));
        assertEquals("PERSONAL_TEACHER",result.get("reasonSource"));
    }

    @Test void unknownLessonErrorsAreNotInvented() {
        var result=PostLessonHomeworkReviewMetadata.build(CONTENT,Map.of());
        assertTrue(((String)result.get("why")).contains("Повторение и закрепление"));
        assertFalse(((String)result.get("why")).contains("ошиб"));
    }

    @Test void longPrivateInstructionsAreBounded() {
        var result=PostLessonHomeworkReviewMetadata.build(CONTENT,
                Map.of("personalTeacherNotes","a".repeat(10000)));
        assertTrue(((String)result.get("why")).length()<300);
    }
}
