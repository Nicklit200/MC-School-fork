package com.mcschool.flashcard.study.dto;

import java.util.UUID;

/**
 * The student's home screen (PRD: "today's tasks"). Tells the UI whether a
 * scheduled session or voluntary practice can be started right now, and surfaces
 * any session already in progress so it can be resumed.
 *
 * @param dueCardCount        cards due for today's mandatory session
 * @param minCardsToStart     minimum cards required before any session can start (1)
 * @param canStartScheduled   at least one card is available and due today
 * @param canPractice         at least one card is available for voluntary practice
 * @param inProgressSessionId an unfinished session to resume, or {@code null}
 */
public record TodayResponse(
        long totalCards,
        long dueCardCount,
        long learnedCount,
        int minCardsToStart,
        boolean canStartScheduled,
        boolean canPractice,
        UUID inProgressSessionId
) {
}
