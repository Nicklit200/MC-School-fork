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

    /** At most one target; neither is set while the teacher prepares alone. */
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

    /** LiveKit dispatch identifier, required for correct agent shutdown. */
    @Column(name = "transcription_dispatch_id", length = 255)
    private String transcriptionDispatchId;

    @Column(name = "actual_start_at")
    private Instant actualStartAt;

    @Column(name = "actual_end_at")
    private Instant actualEndAt;

    /** Explicit teacher opening may move a lesson later than its calendar slot. */
    @Column(name = "student_join_until")
    private Instant studentJoinUntil;

    /** First successful provider observation of an empty open room. */
    @Column(name = "empty_since")
    private Instant emptySince;

    /** Retry room teardown after a provider outage; ending locally is final. */
    @Column(name = "media_close_pending", nullable = false)
    private boolean mediaClosePending;

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
        if (student != null && group != null) {
            throw new IllegalArgumentException("An online class cannot target both a student and a group");
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
        if (student == null) throw new IllegalArgumentException("A student is required");
        return new OnlineClass(teacher, eventId, bindingKey, title, scheduledStartAt, scheduledEndAt,
                student, null);
    }

    public static OnlineClass forGroup(User teacher, String eventId, String bindingKey, String title,
                                       Instant scheduledStartAt, Instant scheduledEndAt, StudentGroup group) {
        if (group == null) throw new IllegalArgumentException("A group is required");
        return new OnlineClass(teacher, eventId, bindingKey, title, scheduledStartAt, scheduledEndAt,
                null, group);
    }

    /** The verified lesson exists, but only its teacher may enter until an audience is assigned. */
    public static OnlineClass forTeacherOnly(User teacher, String eventId, String bindingKey, String title,
                                             Instant scheduledStartAt, Instant scheduledEndAt) {
        return new OnlineClass(teacher, eventId, bindingKey, title, scheduledStartAt, scheduledEndAt, null, null);
    }

    public boolean isTeacherOnly() {
        return student == null && group == null;
    }

    /** Only the initial assignment may retain the teacher's existing room and ink. */
    public void promoteToStudent(User student) {
        if (student == null) throw new IllegalArgumentException("A student is required");
        requireTeacherOnlyPromotion();
        this.student = student;
    }

    public void promoteToGroup(StudentGroup group) {
        if (group == null) throw new IllegalArgumentException("A group is required");
        requireTeacherOnlyPromotion();
        this.group = group;
    }

    private void requireTeacherOnlyPromotion() {
        requireNonTerminal("assign an audience to");
        if (!isTeacherOnly()) throw new IllegalStateException("This classroom already has an audience");
    }

    /** Updating the lesson schedule must never change room ID or recorded attendance. */
    public void reschedule(java.time.Instant start, java.time.Instant end) {
        if (start == null || end == null || !end.isAfter(start)) {
            throw new IllegalArgumentException("Invalid classroom schedule");
        }
        scheduledStartAt = start;
        scheduledEndAt = end;
        studentJoinUntil = com.mcschool.flashcard.liveclasses.LessonEntryPolicy.dayEnd(start);
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

    public void observeEmpty(Instant now) {
        if (emptySince == null) emptySince = now;
    }

    public void observeOccupied() {
        emptySince = null;
    }

    public void setMediaClosePending(boolean pending) {
        mediaClosePending = pending;
    }

    public void allowStudentJoiningUntil(Instant expiresAt) {
        this.studentJoinUntil = expiresAt;
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

    public void setTranscriptionDispatchId(String dispatchId) {
        this.transcriptionDispatchId = dispatchId;
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
