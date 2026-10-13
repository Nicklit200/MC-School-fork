package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.ClassMessageType;
import com.mcschool.flashcard.liveclasses.OnlineClassMessage;
import java.time.Instant;
import java.util.UUID;

/**
 * A chat message. {@code body} is plain text and must be rendered as text — the
 * client never interprets it as HTML.
 */
public record ChatMessageResponse(
        UUID id,
        UUID clientMessageId,
        UUID senderId,
        String senderName,
        String body,
        ClassMessageType messageType,
        Instant createdAt,
        Instant editedAt,
        boolean deleted
) {

    public static ChatMessageResponse from(OnlineClassMessage source) {
        return new ChatMessageResponse(
                source.getId(),
                source.getClientMessageId(),
                source.getSender().getId(),
                source.getSender().getFullName(),
                source.getBody(),
                source.getMessageType(),
                source.getCreatedAt(),
                source.getEditedAt(),
                source.isDeleted());
    }
}
