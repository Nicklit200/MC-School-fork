package com.mcschool.flashcard.parents;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ParentSkillProgressServiceTest {
    @Test void parentFacingTextKeepsLearningFeedbackAndRemovesInternalAttribution() {
        String result=ParentSkillProgressService.parentFacingText(
                "В начале путал правила знаков. Позже правильно решил несколько примеров. "
                + "Авторство этих ответов подтверждено транскрипцией с userId Семёна. "
                + "Источник: boardId personal-123.");

        assertThat(result).contains("В начале путал правила знаков.")
                .contains("Позже правильно решил несколько примеров.");
        assertThat(result).doesNotContainIgnoringCase("userId")
                .doesNotContainIgnoringCase("transcript")
                .doesNotContain("транскрипц")
                .doesNotContain("Авторство")
                .doesNotContain("boardId")
                .doesNotContain("Источник:");
    }

    @Test void parentFacingTextUsesNeutralFallbackWhenOnlyTechnicalDetailsRemain() {
        assertThat(ParentSkillProgressService.parentFacingText(
                "Авторство подтверждено транскрипцией с userId ученика."))
                .isEqualTo("На уроке работали над этим навыком. Продолжим закреплять его на следующих занятиях.");
    }
}
