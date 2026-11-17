package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class WorkbookContentMathValidationTest {
    @Test void refusesEmptyOrMalformedMathTokensBeforePdfRendering() {
        assertThatThrownBy(() -> WorkbookContentService.validateMathExpressions(Map.of(
                "workbookPages", List.of(Map.of("blocks", List.of(Map.of(
                        "type", "exercise", "rows", List.of(Map.of("math", Map.of("tokens", List.of()))))))))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> WorkbookContentService.validateMathExpressions(Map.of(
                "math", Map.of("tokens", List.of(" ")))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void permitsValidLatexAndFractionTokens() {
        assertThatCode(() -> WorkbookContentService.validateMathExpressions(Map.of(
                "workbookPages", List.of(Map.of("blocks", List.of(Map.of(
                        "type", "exercise", "rows", List.of(
                                Map.of("math", Map.of("tokens", List.of("3/4", "+", "1/8", "=", "_____"))),
                                Map.of("math", Map.of("latex", "\\\\frac{3}{4}+\\\\frac{1}{8}"))
                        ))))))))
                .doesNotThrowAnyException();
    }
}
