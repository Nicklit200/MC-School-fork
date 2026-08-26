package com.mcschool.flashcard.study;

import com.mcschool.flashcard.cards.CardStatus;
import java.time.LocalDate;
import org.springframework.stereotype.Component;

/**
 * Compact spaced-repetition schedule for school flashcards.
 *
 * <p>After a clean successful review in a <b>scheduled</b> session, the card moves
 * through the fixed intervals 1 -> 2 -> 4 -> 7 days.
 *
 * <p>If the student makes at least one mistake on a card during a scheduled review,
 * that card is still retried in the same session until answered correctly, but its
 * spaced-repetition streak is reset. After the session completes, the card starts
 * again from repetition 1 and is due the next day.
 *
 * <p>A card is considered <b>learned after 4 clean successful repetitions</b>.
 * Voluntary practice sessions never change the schedule.
 */
@Component
public class Sm2Scheduler {

    /** Days until the next review after repetitions 1, 2, 3 and 4 respectively. */
    static final int[] INTERVAL_DAYS = {1, 2, 4, 7};

    /** A card is learned once it has completed this many clean scheduled reviews. */
    static final int REPETITIONS_TO_LEARN = INTERVAL_DAYS.length;

    /** The new spaced-repetition state to store on a card. */
    public record Scheduling(int repetitionNumber, LocalDate dueDate, CardStatus status) {
    }

    /** Advances a card after a scheduled review with no wrong attempt. */
    public Scheduling afterSuccessfulReview(int currentRepetition, LocalDate today) {
        int newRepetition = currentRepetition + 1;
        int intervalDays = INTERVAL_DAYS[Math.min(newRepetition, REPETITIONS_TO_LEARN) - 1];
        CardStatus status = newRepetition >= REPETITIONS_TO_LEARN ? CardStatus.LEARNED : CardStatus.ACTIVE;
        return new Scheduling(newRepetition, today.plusDays(intervalDays), status);
    }

    /**
     * Resets the spaced-repetition streak after any wrong attempt in a scheduled
     * review. The card becomes active again and restarts at the first interval,
     * so it is due tomorrow regardless of its previous repetition number.
     */
    public Scheduling afterReviewWithMistake(LocalDate today) {
        return new Scheduling(1, today.plusDays(INTERVAL_DAYS[0]), CardStatus.ACTIVE);
    }
}
