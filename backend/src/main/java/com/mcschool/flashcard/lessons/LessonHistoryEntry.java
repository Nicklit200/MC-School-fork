package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.io.Serializable;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "lesson_history")
@IdClass(LessonHistoryEntry.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LessonHistoryEntry {

    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private User teacher;

    @Id
    @Column(name = "event_id", nullable = false, length = 255)
    private String eventId;

    @Column(name = "binding_key", length = 255)
    private String bindingKey;

    @Column(name = "group_id")
    private UUID groupId;

    @Column(name = "group_name", length = 255)
    private String groupName;

    @Column(name = "student_id")
    private UUID studentId;

    @Column(name = "student_name", length = 255)
    private String studentName;

    @Column(name = "participant_student_ids", columnDefinition = "text")
    private String participantStudentIds;

    @Column(nullable = false, length = 500)
    private String title;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Column(name = "meet_url", columnDefinition = "text")
    private String meetUrl;

    @Column(name = "calendar_url", columnDefinition = "text")
    private String calendarUrl;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private LessonHistoryEntry(User teacher, String eventId) {
        this.teacher = teacher;
        this.eventId = eventId;
    }

    public static LessonHistoryEntry create(User teacher, GroupLessonResponse lesson) {
        LessonHistoryEntry entry = new LessonHistoryEntry(teacher, lesson.eventId());
        entry.sync(lesson);
        return entry;
    }

    public void sync(GroupLessonResponse lesson) {
        this.bindingKey = lesson.bindingKey();
        this.groupId = lesson.groupId();
        this.groupName = lesson.groupName();
        this.studentId = lesson.studentId();
        this.studentName = lesson.studentName();
        if (this.participantStudentIds == null || this.participantStudentIds.isBlank()) {
            this.participantStudentIds = encodeParticipants(lesson.participantStudentIds());
        }
        this.title = lesson.title();
        this.startsAt = lesson.startsAt();
        this.endsAt = lesson.endsAt();
        this.meetUrl = lesson.meetUrl();
        this.calendarUrl = lesson.calendarUrl();
    }

    public GroupLessonResponse toResponse() {
        return new GroupLessonResponse(
                eventId,
                bindingKey == null || bindingKey.isBlank() ? eventId : bindingKey,
                groupId,
                groupName,
                studentId,
                studentName,
                decodeParticipants(participantStudentIds),
                title,
                startsAt,
                endsAt,
                meetUrl,
                calendarUrl
        );
    }

    private static String encodeParticipants(List<UUID> ids) {
        if (ids == null || ids.isEmpty()) return null;
        return ids.stream().distinct().map(UUID::toString).sorted().reduce((a, b) -> a + "," + b).orElse(null);
    }

    private static List<UUID> decodeParticipants(String value) {
        if (value == null || value.isBlank()) return List.of();
        return Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(item -> !item.isBlank())
                .map(UUID::fromString)
                .toList();
    }

    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Key implements Serializable {
        private UUID teacher;
        private String eventId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Key key)) return false;
            return Objects.equals(teacher, key.teacher) && Objects.equals(eventId, key.eventId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(teacher, eventId);
        }
    }
}
