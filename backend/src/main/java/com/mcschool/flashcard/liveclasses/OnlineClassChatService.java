package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.ChatMessageResponse;
import com.mcschool.flashcard.liveclasses.dto.ChatPageResponse;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persistent class chat.
 *
 * <p>The backend is the source of truth; the realtime channel is only a fast
 * path. Clients merge the two by {@code clientMessageId}, which is also the
 * server-side idempotency key, so a retried send can never produce a duplicate.
 *
 * <p>Editing rule: a participant may edit or delete their <em>own</em> messages;
 * the host may delete anyone's. System messages are server-authored and cannot
 * be edited or deleted by any client.
 */
@Service
public class OnlineClassChatService {

    /** Rate limit: messages one sender may post in {@link #RATE_WINDOW}. */
    static final int RATE_LIMIT_MESSAGES = 10;
    static final Duration RATE_WINDOW = Duration.ofSeconds(10);

    private static final int MAX_PAGE_SIZE = 100;
    private static final int DEFAULT_PAGE_SIZE = 50;

    private final OnlineClassMessageRepository messageRepository;
    private final OnlineClassAccessService accessService;
    private final OnlineClassMetrics metrics;
    private final Clock clock;

    public OnlineClassChatService(OnlineClassMessageRepository messageRepository,
                                  OnlineClassAccessService accessService,
                                  OnlineClassMetrics metrics,
                                  Clock clock) {
        this.messageRepository = messageRepository;
        this.accessService = accessService;
        this.metrics = metrics;
        this.clock = clock;
    }

    /**
     * Posts a message, or returns the existing one when this
     * {@code clientMessageId} has already been used in this class.
     */
    @Transactional
    public ChatMessageResponse send(AuthenticatedUser caller, UUID classId,
                                    UUID clientMessageId, String body) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);

        // Idempotency is checked before the rate limit so a client retrying
        // after a timeout is not punished for the original attempt.
        var existing = messageRepository.findByOnlineClassIdAndClientMessageId(classId, clientMessageId);
        if (existing.isPresent()) {
            return ChatMessageResponse.from(existing.get());
        }

        if (onlineClass.isTerminal()) {
            throw new ConflictException("This class has ended");
        }
        requireWithinRateLimit(classId, caller.id());

        String sanitized = sanitize(body);
        if (sanitized.isEmpty()) {
            throw new ConflictException("Message must not be blank");
        }

        User sender = accessService.requireActiveUser(caller.id());
        OnlineClassMessage message = OnlineClassMessage.fromUser(
                onlineClass, sender, clientMessageId, sanitized);
        return ChatMessageResponse.from(messageRepository.save(message));
    }

    /**
     * A page of history, newest page first but oldest-first within the page so
     * the client can append directly.
     */
    @Transactional(readOnly = true)
    public ChatPageResponse history(AuthenticatedUser caller, UUID classId, UUID before, Integer size) {
        accessService.requireParticipant(caller, classId);

        int pageSize = size == null ? DEFAULT_PAGE_SIZE : Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        // Fetch one extra to discover whether an older page exists.
        List<OnlineClassMessage> found = messageRepository.findPage(
                classId, before, PageRequest.of(0, pageSize + 1));

        boolean hasMore = found.size() > pageSize;
        List<OnlineClassMessage> page = hasMore ? found.subList(0, pageSize) : found;

        List<ChatMessageResponse> messages = new ArrayList<>(page.stream()
                .map(ChatMessageResponse::from)
                .toList());
        Collections.reverse(messages);

        UUID nextCursor = hasMore && !page.isEmpty() ? page.get(page.size() - 1).getId() : null;
        return new ChatPageResponse(messages, nextCursor, hasMore);
    }

    /** Only the author may edit, and only their own non-deleted user message. */
    @Transactional
    public ChatMessageResponse edit(AuthenticatedUser caller, UUID classId, UUID messageId, String body) {
        accessService.requireParticipant(caller, classId);
        OnlineClassMessage message = requireMessage(classId, messageId);

        if (!message.getSender().getId().equals(caller.id())) {
            // Reported as not-found so one participant cannot probe for the
            // existence of another's message.
            throw new ResourceNotFoundException("Message not found");
        }
        String sanitized = sanitize(body);
        if (sanitized.isEmpty()) {
            throw new ConflictException("Message must not be blank");
        }
        message.edit(sanitized, clock.instant());
        return ChatMessageResponse.from(message);
    }

    /** The author may delete their own message; the host may delete any. */
    @Transactional
    public ChatMessageResponse delete(AuthenticatedUser caller, UUID classId, UUID messageId) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        OnlineClassMessage message = requireMessage(classId, messageId);

        boolean isAuthor = message.getSender().getId().equals(caller.id());
        boolean isHost = accessService.isHost(caller, onlineClass);
        if (!isAuthor && !isHost) {
            throw new ResourceNotFoundException("Message not found");
        }
        if (message.getMessageType() == ClassMessageType.SYSTEM) {
            throw new ConflictException("System messages cannot be deleted");
        }

        message.softDelete(accessService.requireActiveUser(caller.id()), clock.instant());
        return ChatMessageResponse.from(message);
    }

    private void requireWithinRateLimit(UUID classId, UUID senderId) {
        Instant since = clock.instant().minus(RATE_WINDOW);
        long recent = messageRepository
                .countByOnlineClassIdAndSenderIdAndCreatedAtAfter(classId, senderId, since);
        if (recent >= RATE_LIMIT_MESSAGES) {
            metrics.rateLimited("chat");
            throw new ConflictException("You are sending messages too quickly");
        }
    }

    private OnlineClassMessage requireMessage(UUID classId, UUID messageId) {
        return messageRepository.findByIdAndOnlineClassId(messageId, classId)
                .orElseThrow(() -> new ResourceNotFoundException("Message not found"));
    }

    /**
     * Stores plain text only.
     *
     * <p>Strips control characters (which can hide content or break rendering)
     * and collapses runs of newlines. No HTML escaping happens here: the body is
     * stored verbatim-as-text and escaped at render time, so escaping twice
     * would corrupt legitimate characters like {@code &} or {@code <}.
     */
    static String sanitize(String body) {
        if (body == null) {
            return "";
        }
        String withoutControls = body.replaceAll("[\\p{Cntrl}&&[^\n\t]]", "");
        String collapsedNewlines = withoutControls.replaceAll("\n{3,}", "\n\n");
        return collapsedNewlines.strip();
    }
}
