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
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "online_class_attendance", uniqueConstraints = {
        @UniqueConstraint(name = "uq_online_class_attendance_entity", columnNames = {"class_id", "student_id"})
})
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OnlineClassAttendance {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AttendanceStatus status;

    @Column(name = "connected_seconds", nullable = false)
    private long connectedSeconds;

    @Column(name = "confirmed_at", nullable = false)
    private Instant confirmedAt;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "confirmed_by", nullable = false)
    private User confirmedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private OnlineClassAttendance(OnlineClass onlineClass, User student, AttendanceStatus status,
                                  long connectedSeconds, Instant confirmedAt, User confirmedBy) {
        this.id = UUID.randomUUID();
        this.onlineClass = onlineClass;
        this.student = student;
        this.status = status;
        this.connectedSeconds = Math.max(0, connectedSeconds);
        this.confirmedAt = confirmedAt;
        this.confirmedBy = confirmedBy;
    }

    public static OnlineClassAttendance create(OnlineClass onlineClass, User student,
                                               AttendanceStatus status, long connectedSeconds,
                                               Instant confirmedAt, User confirmedBy) {
        return new OnlineClassAttendance(
                onlineClass, student, status, connectedSeconds, confirmedAt, confirmedBy);
    }

    public void confirm(AttendanceStatus status, long connectedSeconds,
                        Instant confirmedAt, User confirmedBy) {
        this.status = status;
        this.connectedSeconds = Math.max(0, connectedSeconds);
        this.confirmedAt = confirmedAt;
        this.confirmedBy = confirmedBy;
    }
}
