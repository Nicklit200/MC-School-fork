package com.mcschool.flashcard.cards;

import static org.assertj.core.api.Assertions.assertThat;

import com.mcschool.flashcard.cards.dto.ImportPreviewResponse;
import org.junit.jupiter.api.Test;

class CardImportParserTest {

    private final CardImportParser parser = new CardImportParser();

    @Test
    void parsesValidImportRowsWithCorrectAndThreeWrongAnswers() {
        String text = """
                Was bedeutet „notieren“? -> записать | проверить | вычислить | сравнить
                24 Flaschen, 7 werden herausgenommen. Welche Rechnung passt? -> 24 - 7 | 24 + 7 | 7 - 24 | 24 ÷ 7
                """;

        ImportPreviewResponse result = parser.parse(text, "->", "\n");

        assertThat(result.cards()).hasSize(2);
        assertThat(result.cards().get(0).question()).isEqualTo("Was bedeutet „notieren“?");
        assertThat(result.cards().get(0).correctAnswer()).isEqualTo("записать");
        assertThat(result.cards().get(0).wrongAnswer1()).isEqualTo("проверить");
        assertThat(result.cards().get(0).wrongAnswer2()).isEqualTo("вычислить");
        assertThat(result.cards().get(0).wrongAnswer3()).isEqualTo("сравнить");
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void rejectsRowsWithOnlyTwoWrongAnswers() {
        ImportPreviewResponse result = parser.parse("Question -> right | wrong1 | wrong2", "->", "\n");

        assertThat(result.cards()).isEmpty();
        assertThat(result.warnings()).singleElement()
                .satisfies(warning -> assertThat(warning)
                        .contains("Line 1")
                        .contains("expected 4 answers"));
    }

    @Test
    void rejectsRowsWithDuplicateAnswers() {
        ImportPreviewResponse result = parser.parse("Question -> right | wrong1 | right | wrong3", "->", "\n");

        assertThat(result.cards()).isEmpty();
        assertThat(result.warnings()).singleElement()
                .satisfies(warning -> assertThat(warning)
                        .contains("Line 1")
                        .contains("all 4 answers must be different"));
    }

    @Test
    void rejectsEmptyQuestionOrEmptyAnswerWithLineNumbers() {
        ImportPreviewResponse result = parser.parse("""
                 -> right | wrong1 | wrong2 | wrong3
                Question -> right |  | wrong2 | wrong3
                """, "->", "\n");

        assertThat(result.cards()).isEmpty();
        assertThat(result.warnings()).hasSize(2);
        assertThat(result.warnings().get(0)).contains("Line 1").contains("empty question");
        assertThat(result.warnings().get(1)).contains("Line 2").contains("answers must be non-empty");
    }

    @Test
    void skipsRowsWithoutArrowSeparator() {
        ImportPreviewResponse result = parser.parse("Question = right | wrong1 | wrong2 | wrong3", "->", "\n");

        assertThat(result.cards()).isEmpty();
        assertThat(result.warnings()).singleElement()
                .satisfies(warning -> assertThat(warning)
                        .contains("Line 1")
                        .contains("missing -> separator"));
    }
}
