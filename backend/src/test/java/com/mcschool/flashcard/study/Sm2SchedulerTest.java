package com.mcschool.flashcard.study;

import static org.assertj.core.api.Assertions.assertThat;

import com.mcschool.flashcard.cards.CardStatus;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class Sm2SchedulerTest {

    private final Sm2Scheduler scheduler = new Sm2Scheduler();
    private final LocalDate today = LocalDate.of(2026, 7, 20);

    @Test
    void firstSuccessfulReviewSchedulesInOneDay() {
        Sm2Scheduler.Scheduling result = scheduler.afterSuccessfulReview(0, today);

        assertThat(result.repetitionNumber()).isEqualTo(1);
        assertThat(result.dueDate()).isEqualTo(today.plusDays(1));
        assertThat(result.status()).isEqualTo(CardStatus.ACTIVE);
    }

    @Test
    void secondSuccessfulReviewSchedulesInTwoDays() {
        Sm2Scheduler.Scheduling result = scheduler.afterSuccessfulReview(1, today);

        assertThat(result.repetitionNumber()).isEqualTo(2);
        assertThat(result.dueDate()).isEqualTo(today.plusDays(2));
        assertThat(result.status()).isEqualTo(CardStatus.ACTIVE);
    }

    @Test
    void thirdSuccessfulReviewSchedulesInFourDays() {
        Sm2Scheduler.Scheduling result = scheduler.afterSuccessfulReview(2, today);

        assertThat(result.repetitionNumber()).isEqualTo(3);
        assertThat(result.dueDate()).isEqualTo(today.plusDays(4));
        assertThat(result.status()).isEqualTo(CardStatus.ACTIVE);
    }

    @Test
    void fourthSuccessfulReviewSchedulesInSevenDaysAndMarksLearned() {
        Sm2Scheduler.Scheduling result = scheduler.afterSuccessfulReview(3, today);

        assertThat(result.repetitionNumber()).isEqualTo(4);
        assertThat(result.dueDate()).isEqualTo(today.plusDays(7));
        assertThat(result.status()).isEqualTo(CardStatus.LEARNED);
    }

    @Test
    void wrongAttemptRestartsStreakFromOneDay() {
        Sm2Scheduler.Scheduling result = scheduler.afterReviewWithMistake(today);

        assertThat(result.repetitionNumber()).isEqualTo(1);
        assertThat(result.dueDate()).isEqualTo(today.plusDays(1));
        assertThat(result.status()).isEqualTo(CardStatus.ACTIVE);
    }
}
