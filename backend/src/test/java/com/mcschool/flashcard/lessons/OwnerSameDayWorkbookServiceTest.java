package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OwnerSameDayWorkbookServiceTest {
    private static final UUID OWNER = AiLessonPilotService.PILOT_TEACHER_ID;
    private static final UUID OTHER = UUID.fromString("9a86b2f5-8c51-4ab3-8cab-4240bad0f31a");

    @Test void notificationSuccessOpensPdfViewerAndFailuresOpenLesson() {
        assertThat(OwnerSameDayWorkbookService.notificationPath("local-mark", true))
                .isEqualTo("/lesson-workbook-preview/" + OWNER + "/local-mark");
        assertThat(OwnerSameDayWorkbookService.notificationPath("local-mark", false))
                .isEqualTo("/teacher/lessons/local-mark");
    }

    @Test void identifiesMeasuredA4FailuresForBoundedRepair() {
        assertThat(OwnerSameDayWorkbookService.isRepairableLayoutFailure(
                new IllegalArgumentException("Workbook generation/QA failed: Layout QA failed: Page 4: text or SVG exceeds its block")))
                .isTrue();
        assertThat(OwnerSameDayWorkbookService.isRepairableLayoutFailure(
                new IllegalArgumentException("A4 page packing exhausted")))
                .isTrue();
        assertThat(OwnerSameDayWorkbookService.isRepairableLayoutFailure(
                new IllegalArgumentException("Page 2: diagram and its next task exceed one A4 page")))
                .isTrue();
    }

    @Test void neverRepairsIncorrectMathOrProviderErrorsAsLayout() {
        assertThat(OwnerSameDayWorkbookService.isRepairableLayoutFailure(
                new IllegalArgumentException("Algebra QA did not pass"))).isFalse();
        assertThat(OwnerSameDayWorkbookService.isRepairableLayoutFailure(
                new IllegalStateException("Workbook content provider returned HTTP 401"))).isFalse();
    }

    @Test void beforeNineDoesNotGenerate() {
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER,
                Instant.parse("2026-11-17T16:00:00Z"),
                Instant.parse("2026-11-17T07:59:00Z"), true)).isFalse();
    }

    @Test void afterNineExistingLessonIsEligible() {
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER,
                Instant.parse("2026-11-17T16:00:00Z"),
                Instant.parse("2026-11-17T08:00:00Z"), true)).isTrue();
    }

    @Test void laterTodayLessonIsEligibleEvenWhenCreatedAtFourPm() {
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER,
                Instant.parse("2026-11-17T16:00:00Z"),
                Instant.parse("2026-11-17T15:00:00Z"), true)).isTrue();
    }

    @Test void neverGeneratesFutureOrPastDaysOrAlreadyStartedLessons() {
        Instant now = Instant.parse("2026-11-17T15:00:00Z");
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER,
                Instant.parse("2026-11-24T16:00:00Z"), now, true)).isFalse();
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER,
                Instant.parse("2026-11-16T16:00:00Z"), now, true)).isFalse();
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER, now, now, true)).isFalse();
    }

    @Test void privatePilotOnlyAndNeverUnassignedLessons() {
        Instant now = Instant.parse("2026-11-17T12:00:00Z");
        Instant lesson = Instant.parse("2026-11-17T16:00:00Z");
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OTHER, lesson, now, true)).isFalse();
        assertThat(OwnerSameDayWorkbookService.eligibleAt(OWNER, lesson, now, false)).isFalse();
    }
}
