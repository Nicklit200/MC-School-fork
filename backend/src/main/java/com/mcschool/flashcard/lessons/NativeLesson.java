package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

@Entity
@Table(name = "native_lessons")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class NativeLesson {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private User teacher;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id")
    private User student;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private StudentGroup group;

    @Column(nullable = false, length = 255)
    private String title;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Column(name = "series_id", nullable = false)
    private UUID seriesId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private NativeLesson(User teacher, User student, StudentGroup group, String title,
                         Instant startsAt, Instant endsAt, UUID seriesId) {
        if ((student == null) == (group == null)) {
            throw new IllegalArgumentException("A lesson must target exactly one student or group");
        }
        if (startsAt == null || endsAt == null || !endsAt.isAfter(startsAt)) {
            throw new IllegalArgumentException("Lesson end must be after start");
        }
        this.id = UUID.randomUUID();
        this.teacher = teacher;
        this.student = student;
        this.group = group;
        this.title = title == null || title.isBlank() ? "Урок" : title.strip();
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.seriesId = seriesId == null ? UUID.randomUUID() : seriesId;
    }

    public static NativeLesson forStudent(User teacher, User student, String title,
                                          Instant startsAt, Instant endsAt, UUID seriesId) {
        return new NativeLesson(teacher, student, null, title, startsAt, endsAt, seriesId);
    }

    public static NativeLesson forGroup(User teacher, StudentGroup group, String title,
                                        Instant startsAt, Instant endsAt, UUID seriesId) {
        return new NativeLesson(teacher, null, group, title, startsAt, endsAt, seriesId);
    }

    public String eventId() {
        return "native:" + id;
    }

    public String bindingKey() {
        return "native-series:" + seriesId;
    }
}
