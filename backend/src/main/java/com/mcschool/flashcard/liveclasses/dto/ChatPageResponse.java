package com.mcschool.flashcard.liveclasses.dto;

import java.util.List;
import java.util.UUID;

/**
 * One page of history, oldest-first within the page.
 *
 * @param nextCursor pass as {@code before} to fetch the previous page; null when
 *                   the beginning of the conversation has been reached
 */
public record ChatPageResponse(
        List<ChatMessageResponse> messages,
        UUID nextCursor,
        boolean hasMore
) {
}
