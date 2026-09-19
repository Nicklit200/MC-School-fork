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
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One row per (class, user), reused across reconnects.
 *
 * <p>Attendance is accumulated into {@code totalConnectedSeconds} on each leave
 * rather than derived from a single join/leave pair, so a participant who drops
 * and rejoins several times is credited with the sum of their connected time.
 */
@Entity
@Table(name = "online_class_participants")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassParticipant {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(name = "class_role", nullable = false, length = 20)
    private ClassRole classRole;

    @Enumerated(EnumType.STRING)
    @Column(name = "admission_state", nullable = false, length = 20)
    private AdmissionState admissionState;

    @Column(name = "camera_enabled", nullable = false)
    private boolean cameraEnabled;

    @Column(name = "microphone_enabled", nullable = false)
    private boolean microphoneEnabled;

    @Column(name = "screen_share_enabled", nullable = false)
    private boolean screenShareEnabled;

    @Column(name = "first_joined_at")
    private Instant firstJoinedAt;

    @Column(name = "last_joined_at")
    private Instant lastJoinedAt;

    @Column(name = "last_left_at")
    private Instant lastLeftAt;

    @Column(name = "total_connected_seconds", nullable = false)
    private long totalConnectedSeconds;

    @Column(name = "recording_ack_at")
    private Instant recordingAckAt;

    @Column(name = "transcription_ack_at")
    private Instant transcriptionAckAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassParticipant(OnlineClass onlineClass, User user, ClassRole classRole,
                                   AdmissionState admissionState) {
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.user = user;
        this.classRole = classRole;
        this.admissionState = admissionState;
        this.cameraEnabled = true;
        this.microphoneEnabled = true;
        // The host may always share; students follow the class-level setting.
        this.screenShareEnabled = classRole == ClassRole.HOST;
        this.totalConnectedSeconds = 0L;
    }

    /** The owning teacher is admitted immediately; they are the room moderator. */
    public static OnlineClassParticipant host(OnlineClass onlineClass, User teacher) {
        return new OnlineClassParticipant(onlineClass, teacher, ClassRole.HOST, AdmissionState.ADMITTED);
    }

    /**
     * A student starts PENDING when the waiting room is on, otherwise admitted.
     * Authorization to be here at all is decided before this is called.
     */
    public static OnlineClassParticipant student(OnlineClass onlineClass, User student) {
        AdmissionState initial = onlineClass.isWaitingRoomEnabled()
                ? AdmissionState.PENDING
                : AdmissionState.ADMITTED;
        return new OnlineClassParticipant(onlineClass, student, ClassRole.STUDENT, initial);
    }

    public boolean isHost() {
        return classRole == ClassRole.HOST;
    }

    public boolean isAdmitted() {
        return admissionState == AdmissionState.ADMITTED;
    }

    public void admit() {
        if (admissionState == AdmissionState.REMOVED) {
            throw new IllegalStateException("A removed participant cannot be re-admitted with this operation");
        }
        this.admissionState = AdmissionState.ADMITTED;
    }

    public void reject() {
        this.admissionState = AdmissionState.REJECTED;
    }

    /** A removed participant must never be issued a new token. */
    public void remove() {
        this.admissionState = AdmissionState.REMOVED;
    }

    /** Records a (re)connection. The first join is remembered separately. */
    public void markJoined(Instant now) {
        if (this.firstJoinedAt == null) {
            this.firstJoinedAt = now;
        }
        this.lastJoinedAt = now;
    }

    /**
     * Accumulates the elapsed span since the matching join. Ignores a leave with
     * no open join (a duplicate or out-of-order webhook) so attendance cannot be
     * inflated or driven negative.
     */
    public void markLeft(Instant now) {
        if (lastJoinedAt == null || (lastLeftAt != null && !lastLeftAt.isBefore(lastJoinedAt))) {
            return;
        }
        long seconds = Duration.between(lastJoinedAt, now).getSeconds();
        if (seconds > 0) {
            this.totalConnectedSeconds += seconds;
        }
        this.lastLeftAt = now;
    }

    /** True while a join has not yet been closed by a matching leave. */
    public boolean isConnected() {
        return lastJoinedAt != null && (lastLeftAt == null || lastLeftAt.isBefore(lastJoinedAt));
    }

    public void setCameraEnabled(boolean enabled) {
        this.cameraEnabled = enabled;
    }

    public void setMicrophoneEnabled(boolean enabled) {
        this.microphoneEnabled = enabled;
    }

    public void setScreenShareEnabled(boolean enabled) {
        this.screenShareEnabled = enabled;
    }

    public void acknowledgeRecording(Instant now) {
        this.recordingAckAt = now;
    }

    public void acknowledgeTranscription(Instant now) {
        this.transcriptionAckAt = now;
    }
}
