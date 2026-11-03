package com.mcschool.flashcard.study;

import static org.assertj.core.api.Assertions.assertThat;

import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.users.User;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class DistractorGeneratorTest {

    private final DistractorGenerator generator = new DistractorGenerator();
    private final User student = User.bootstrapAdmin("S", "s@test.local", "hash");
    private final User teacher = User.bootstrapAdmin("T", "t@test.local", "hash");

    private Card card(String answer) {
        return Card.create(Homework.create(student, LocalDate.now()), teacher, "What is it?", answer);
    }

    private Card importedCard() {
        return Card.createImported(Homework.create(student, LocalDate.now()), teacher,
                "What is it?", "correct", "saved wrong 1", "saved wrong 2", "saved wrong 3");
    }

    @Test
    void usesSavedWrongAnswersWhenPresent() {
        Card target = importedCard();
        List<Card> all = List.of(target, card("answer from another card"), card("another outside answer"));

        List<String> options = generator.buildOptions(target, all);

        assertThat(options).containsExactlyInAnyOrder("correct", "saved wrong 1", "saved wrong 2", "saved wrong 3");
        assertThat(options).doesNotContain("answer from another card", "another outside answer");
    }

    @Test
    void buildsFourOptionsIncludingTheCorrectAnswer() {
        Card target = card("correct");
        List<Card> all = List.of(target, card("wrong1"), card("wrong2"), card("wrong3"), card("wrong4"));

        List<String> options = generator.buildOptions(target, all);

        assertThat(options).hasSize(4);
        assertThat(options).contains("correct");
        assertThat(options).doesNotHaveDuplicates();
    }

    @Test
    void usesAtMostThreeDistractors() {
        Card target = card("correct");
        List<Card> all = List.of(target,
                card("w1"), card("w2"), card("w3"), card("w4"), card("w5"), card("w6"));

        List<String> options = generator.buildOptions(target, all);

        assertThat(options).hasSize(4);
    }

    @Test
    void returnsFewerOptionsWhenNotEnoughDistinctDistractorsExist() {
        Card target = card("correct");
        List<Card> all = List.of(target, card("only-other"));

        List<String> options = generator.buildOptions(target, all);

        assertThat(options).containsExactlyInAnyOrder("correct", "only-other");
    }

    @Test
    void treatsDuplicateAnswersAsOneDistractor() {
        Card target = card("correct");
        List<Card> all = List.of(target, card("same"), card("same"), card("same"));

        List<String> options = generator.buildOptions(target, all);

        assertThat(options).containsExactlyInAnyOrder("correct", "same");
    }

    @Test
    void neverUsesTheCorrectAnswerAsADistractor() {
        Card target = card("42");
        List<Card> all = List.of(target, card("42"), card("7"), card("13"), card("99"));

        List<String> options = generator.buildOptions(target, all);

        assertThat(options).filteredOn(option -> option.equals("42")).hasSize(1);
    }

    @Test
    void aSinglePlainCardHasOnlyItsCorrectAnswerWithoutFabricatedOptions() {
        Card target = card("correct");
        assertThat(generator.buildOptions(target, List.of(target))).containsExactly("correct");
    }

    @Test
    void threePlainCardsUseTheirThreeRealDistinctAnswersWithoutPadding() {
        Card target = card("correct");
        assertThat(generator.buildOptions(target, List.of(target, card("other-one"), card("other-two"))))
                .containsExactlyInAnyOrder("correct", "other-one", "other-two");
    }

    @Test
    void aSmallDeckWithTheSameAnswerDoesNotRepeatItAsADistractor() {
        Card target = card("same");
        assertThat(generator.buildOptions(target, List.of(target, card("same"), card("same"))))
                .containsExactly("same");
    }

    @Test
    void aSingleImportedCardStillUsesItsThreeTeacherSuppliedWrongAnswers() {
        Card target = importedCard();
        assertThat(generator.buildOptions(target, List.of(target)))
                .containsExactlyInAnyOrder("correct", "saved wrong 1", "saved wrong 2", "saved wrong 3");
    }
}
