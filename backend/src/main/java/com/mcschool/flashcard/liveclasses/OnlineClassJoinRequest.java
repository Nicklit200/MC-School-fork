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
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A waiting-room entry. A partial unique index keeps at most one PENDING
 * request per (class, user), which is what makes repeated knocks idempotent.
 */
@Entity
@Table(name = "online_class_join_requests")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassJoinRequest {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private JoinRequestState state;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "decided_by")
    private User decidedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassJoinRequest(OnlineClass onlineClass, User user, Instant requestedAt) {
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.user = user;
        this.state = JoinRequestState.PENDING;
        this.requestedAt = requestedAt;
    }

    public static OnlineClassJoinRequest knock(OnlineClass onlineClass, User user, Instant now) {
        return new OnlineClassJoinRequest(onlineClass, user, now);
    }

    public boolean isPending() {
        return state == JoinRequestState.PENDING;
    }

    public void approve(User decidedBy, Instant now) {
        decide(JoinRequestState.APPROVED, decidedBy, now);
    }

    public void reject(User decidedBy, Instant now) {
        decide(JoinRequestState.REJECTED, decidedBy, now);
    }

    public void cancel(Instant now) {
        decide(JoinRequestState.CANCELLED, null, now);
    }

    public void expire(Instant now) {
        decide(JoinRequestState.EXPIRED, null, now);
    }

    /**
     * Deciding an already-decided request is rejected rather than silently
     * overwritten, so a double-approve cannot flip a rejection.
     */
    private void decide(JoinRequestState newState, User actor, Instant now) {
        if (state != JoinRequestState.PENDING) {
            throw new IllegalStateException("Join request has already been decided as " + state);
        }
        this.state = newState;
        this.decidedBy = actor;
        this.decidedAt = now;
    }
}
