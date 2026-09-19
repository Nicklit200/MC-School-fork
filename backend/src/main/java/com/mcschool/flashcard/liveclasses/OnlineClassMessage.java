package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * A persisted chat message. The backend — not the realtime channel — is the
 * source of truth; realtime delivery is de-duplicated against
 * {@code clientMessageId}.
 *
 * <p>Bodies are stored and returned as plain text and must never be rendered as
 * HTML.
 */
@Entity
@Table(name = "online_class_messages")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassMessage {

    public static final int MAX_BODY_LENGTH = 2000;

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    @Column(name = "client_message_id", nullable = false)
    private UUID clientMessageId;

    @Column(nullable = false, length = MAX_BODY_LENGTH)
    private String body;

    @Enumerated(EnumType.STRING)
    @Column(name = "message_type", nullable = false, length = 20)
    private ClassMessageType messageType;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "edited_at")
    private Instant editedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "deleted_by")
    private User deletedBy;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassMessage(OnlineClass onlineClass, User sender, UUID clientMessageId,
                               String body, ClassMessageType messageType) {
        String normalized = body == null ? "" : body.strip();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("Message body must not be blank");
        }
        if (normalized.length() > MAX_BODY_LENGTH) {
            throw new IllegalArgumentException("Message body exceeds " + MAX_BODY_LENGTH + " characters");
        }
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.sender = sender;
        this.clientMessageId = clientMessageId;
        this.body = normalized;
        this.messageType = messageType;
    }

    public static OnlineClassMessage fromUser(OnlineClass onlineClass, User sender,
                                              UUID clientMessageId, String body) {
        return new OnlineClassMessage(onlineClass, sender, clientMessageId, body, ClassMessageType.USER);
    }

    /**
     * System notices (joins, recording state) are server-authored. The type is
     * never taken from client input, so a participant cannot forge one.
     */
    public static OnlineClassMessage system(OnlineClass onlineClass, User author, String body) {
        return new OnlineClassMessage(onlineClass, author, UUID.randomUUID(), body, ClassMessageType.SYSTEM);
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public void edit(String newBody, Instant now) {
        if (isDeleted()) {
            throw new IllegalStateException("A deleted message cannot be edited");
        }
        if (messageType == ClassMessageType.SYSTEM) {
            throw new IllegalStateException("System messages cannot be edited");
        }
        String normalized = newBody == null ? "" : newBody.strip();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("Message body must not be blank");
        }
        if (normalized.length() > MAX_BODY_LENGTH) {
            throw new IllegalArgumentException("Message body exceeds " + MAX_BODY_LENGTH + " characters");
        }
        this.body = normalized;
        this.editedAt = now;
    }

    /** Soft delete: the row is retained for audit, the body is cleared. */
    public void softDelete(User actor, Instant now) {
        if (isDeleted()) {
            return;
        }
        this.deletedAt = now;
        this.deletedBy = actor;
        this.body = "";
    }
}
