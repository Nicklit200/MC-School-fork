package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.groups.StudentGroup;
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
 * A durable execution of an existing Google Calendar lesson.
 *
 * <p>This is deliberately <em>not</em> a second scheduling system: the calendar
 * lesson remains the schedule, and this row snapshots the occurrence it was
 * materialized from so post-class artifacts have a stable owner even if the
 * calendar event later changes or disappears.
 */
@Entity
@Table(name = "online_classes")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClass {

    /** Room names are opaque: derived from the id, never from names or e-mails. */
    private static final String ROOM_NAME_PREFIX = "mcs-";

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private User teacher;

    @Column(name = "event_id", nullable = false, length = 255)
    private String eventId;

    @Column(name = "binding_key", nullable = false, length = 255)
    private String bindingKey;

    @Column(nullable = false, length = 255)
    private String title;

    @Column(name = "scheduled_start_at", nullable = false)
    private Instant scheduledStartAt;

    @Column(name = "scheduled_end_at", nullable = false)
    private Instant scheduledEndAt;

    /** Exactly one of student/group is set; enforced by a DB CHECK and here. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id")
    private User student;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private StudentGroup group;

    @Column(name = "room_name", nullable = false, length = 120)
    private String roomName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private OnlineClassStatus status;

    @Column(name = "waiting_room_enabled", nullable = false)
    private boolean waitingRoomEnabled;

    @Column(name = "student_screen_share_enabled", nullable = false)
    private boolean studentScreenShareEnabled;

    @Enumerated(EnumType.STRING)
    @Column(name = "recording_state", nullable = false, length = 20)
    private ClassFeatureState recordingState;

    @Enumerated(EnumType.STRING)
    @Column(name = "transcription_state", nullable = false, length = 20)
    private ClassFeatureState transcriptionState;

    @Column(name = "actual_start_at")
    private Instant actualStartAt;

    @Column(name = "actual_end_at")
    private Instant actualEndAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClass(User teacher, String eventId, String bindingKey, String title,
                        Instant scheduledStartAt, Instant scheduledEndAt,
                        User student, StudentGroup group) {
        if ((student == null) == (group == null)) {
            throw new IllegalArgumentException("An online class must target exactly one student or one group");
        }
        if (!scheduledEndAt.isAfter(scheduledStartAt)) {
            throw new IllegalArgumentException("Scheduled end must be after scheduled start");
        }
        this.id = UUID.randomUUID();
        this.teacher = teacher;
        this.eventId = eventId;
        this.bindingKey = bindingKey;
        this.title = title;
        this.scheduledStartAt = scheduledStartAt;
        this.scheduledEndAt = scheduledEndAt;
        this.student = student;
        this.group = group;
        this.roomName = ROOM_NAME_PREFIX + this.id;
        this.status = OnlineClassStatus.SCHEDULED;
        this.waitingRoomEnabled = true;
        this.studentScreenShareEnabled = false;
        this.recordingState = ClassFeatureState.INACTIVE;
        this.transcriptionState = ClassFeatureState.INACTIVE;
    }

    public static OnlineClass forStudent(User teacher, String eventId, String bindingKey, String title,
                                         Instant scheduledStartAt, Instant scheduledEndAt, User student) {
        return new OnlineClass(teacher, eventId, bindingKey, title, scheduledStartAt, scheduledEndAt,
                student, null);
    }

    public static OnlineClass forGroup(User teacher, String eventId, String bindingKey, String title,
                                       Instant scheduledStartAt, Instant scheduledEndAt, StudentGroup group) {
        return new OnlineClass(teacher, eventId, bindingKey, title, scheduledStartAt, scheduledEndAt,
                null, group);
    }

    public boolean isGroupClass() {
        return group != null;
    }

    /** True once the class has finished or been cancelled; no further joins. */
    public boolean isTerminal() {
        return status == OnlineClassStatus.ENDED || status == OnlineClassStatus.CANCELLED;
    }

    /** Participants may only hold a connection while the lobby or room is open. */
    public boolean isConnectable() {
        return status == OnlineClassStatus.LOBBY_OPEN || status == OnlineClassStatus.LIVE;
    }

    /**
     * Idempotent: opening an already-open lobby (or a live class) is a no-op so
     * a retried request cannot regress state.
     */
    public void openLobby() {
        if (status == OnlineClassStatus.LOBBY_OPEN || status == OnlineClassStatus.LIVE) {
            return;
        }
        requireNonTerminal("open the lobby for");
        this.status = OnlineClassStatus.LOBBY_OPEN;
    }

    /** Idempotent; records the first actual start only. */
    public void start(Instant now) {
        if (status == OnlineClassStatus.LIVE) {
            return;
        }
        requireNonTerminal("start");
        this.status = OnlineClassStatus.LIVE;
        if (this.actualStartAt == null) {
            this.actualStartAt = now;
        }
    }

    /** Idempotent; ending an ended class does not move the recorded end time. */
    public void end(Instant now) {
        if (status == OnlineClassStatus.ENDED) {
            return;
        }
        if (status == OnlineClassStatus.CANCELLED) {
            throw new IllegalStateException("A cancelled class cannot be ended");
        }
        this.status = OnlineClassStatus.ENDED;
        if (this.actualEndAt == null) {
            this.actualEndAt = now;
        }
        this.recordingState = ClassFeatureState.INACTIVE;
        this.transcriptionState = ClassFeatureState.INACTIVE;
    }

    /** Only a class that never went live may be cancelled. */
    public void cancel() {
        if (status == OnlineClassStatus.CANCELLED) {
            return;
        }
        if (status == OnlineClassStatus.LIVE || status == OnlineClassStatus.ENDED) {
            throw new IllegalStateException("A class that has already started cannot be cancelled");
        }
        this.status = OnlineClassStatus.CANCELLED;
    }

    public void setWaitingRoomEnabled(boolean enabled) {
        this.waitingRoomEnabled = enabled;
    }

    public void setStudentScreenShareEnabled(boolean enabled) {
        this.studentScreenShareEnabled = enabled;
    }

    public void setRecordingState(ClassFeatureState state) {
        this.recordingState = state;
    }

    public void setTranscriptionState(ClassFeatureState state) {
        this.transcriptionState = state;
    }

    private void requireNonTerminal(String action) {
        if (isTerminal()) {
            throw new IllegalStateException("Cannot " + action + " a class that is " + status);
        }
    }
}
