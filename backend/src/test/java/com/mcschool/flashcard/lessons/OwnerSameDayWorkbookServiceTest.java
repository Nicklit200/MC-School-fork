package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OwnerSameDayWorkbookServiceTest {
    private static final UUID OWNER = AiLessonPilotService.PILOT_TEACHER_ID;
    private static final UUID OTHER = UUID.fromString("9a86b2f5-8c51-4ab3-8cab-4240bad0f31a");

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
