package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class KolinExerciseIndexTest {
    @Test void acceptsNaturalRussianGermanAndEnglishNumberedQuestions() {
        assertThat(KolinExerciseIndex.requestedNumber("Объясни задание 7")).isEqualTo(7);
        assertThat(KolinExerciseIndex.requestedNumber("Обьесни задание №7")).isEqualTo(7);
        assertThat(KolinExerciseIndex.requestedNumber("Почему седьмое задание неверно?")).isEqualTo(7);
        assertThat(KolinExerciseIndex.requestedNumber("Объясни 7-е задание")).isEqualTo(7);
        assertThat(KolinExerciseIndex.requestedNumber("Explain task 7")).isEqualTo(7);
        assertThat(KolinExerciseIndex.requestedNumber("Erkläre Aufgabe 7")).isEqualTo(7);
        assertThat(KolinExerciseIndex.requestedNumber("Проверь задание 17")).isEqualTo(17);
        assertThat(KolinExerciseIndex.requestedNumber("Что случилось в 7:30 на уроке?")).isNull();
        assertThat(KolinExerciseIndex.requestedNumber("Отключился ли ученик?")).isNull();
    }

    @Test void extractsNumberedPageTextWithoutConfusingItWithPhysicalPage() {
        String text="""
            Mathematik / Arbeitsheft
            Anwendung und selbstständiges Üben
            7
            Erkläre, warum die Aussage nicht immer stimmt:
            sqrt(x^2) = x
            a) x = -3
            b) x = 5
            8. Berechne die Werte.
            sqrt(49)
            9) Loese das Problem.
            x + 2 = 6
            """;
        var tasks=KolinExerciseIndex.fromPage(3,text);
        assertThat(tasks).extracting(KolinExerciseIndex.Exercise::number).containsExactly(7,8,9);
        assertThat(tasks.get(0).pageNumber()).isEqualTo(3);
        assertThat(tasks.get(0).text()).contains("sqrt(x^2) = x","x = -3","x = 5")
            .doesNotContain("Berechne");
        assertThat(tasks.get(1).text()).contains("sqrt(49)");
        assertThat(KolinExerciseIndex.fromPage(7,"Page 7\nMathematik")).isEmpty();
    }

    @Test void versionedStableTaskReferenceNeverContainsRawBoardOrUserIdentifiers() {
        var task=KolinExerciseIndex.fromPage(1,"TASK 7: Find the root\nsqrt(64)").get(0);
        var id=KolinExerciseIndex.id("personal-workbook-7a4d7545-254d-4db3-a61c-ec01798a5366",9,task);
        assertThat(id).matches("task-[a-f0-9]{24}");
        assertThat(id).isEqualTo(KolinExerciseIndex.id("personal-workbook-7a4d7545-254d-4db3-a61c-ec01798a5366",9,task));
        assertThat(id).isNotEqualTo(KolinExerciseIndex.id("personal-workbook-7a4d7545-254d-4db3-a61c-ec01798a5366",10,task))
            .doesNotContain("7a4d7545");
    }

    @Test void boundedExerciseTextDoesNotLeakOtherExercisesAndIgnoresNonNumberedContent() {
        assertThat(KolinExerciseIndex.fromPage(1,"A plain worksheet without task headings")).isEmpty();
        var tasks=KolinExerciseIndex.fromPage(2,"Aufgabe 7: "+ "x".repeat(2400)+"\nAufgabe 8: Work");
        assertThat(tasks).hasSize(2);
        assertThat(tasks.get(0).text()).hasSize(KolinExerciseIndex.MAX_TASK_TEXT);
        assertThat(tasks.get(0).truncated()).isTrue();
        assertThat(tasks.get(1).text()).isEqualTo("Work");
    }
}
