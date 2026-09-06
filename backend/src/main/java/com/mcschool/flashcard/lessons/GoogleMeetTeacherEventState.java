package com.mcschool.flashcard.lessons;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "google_meet_teacher_event_state")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GoogleMeetTeacherEventState {

    @Id
    @Column(name = "teacher_id")
    private UUID teacherId;

    @Column(name = "google_user_id", length = 255)
    private String googleUserId;

    @Column(name = "workspace_subscription_name", length = 500)
    private String workspaceSubscriptionName;

    @Column(name = "subscription_expires_at")
    private Instant subscriptionExpiresAt;

    @Column(name = "last_left_at")
    private Instant lastLeftAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public static GoogleMeetTeacherEventState create(UUID teacherId) {
        GoogleMeetTeacherEventState state = new GoogleMeetTeacherEventState();
        state.teacherId = teacherId;
        state.updatedAt = Instant.now();
        return state;
    }

    public void updateSubscription(String googleUserId, String subscriptionName, Instant expiresAt) {
        this.googleUserId = googleUserId;
        this.workspaceSubscriptionName = subscriptionName;
        this.subscriptionExpiresAt = expiresAt;
        this.updatedAt = Instant.now();
    }

    public void markLeft(Instant leftAt) {
        this.lastLeftAt = leftAt == null ? Instant.now() : leftAt;
        this.updatedAt = Instant.now();
    }
}
