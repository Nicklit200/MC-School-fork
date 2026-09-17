package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.User;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "google_calendar_lesson_bindings")
@IdClass(GoogleCalendarLessonBinding.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GoogleCalendarLessonBinding {

    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private User teacher;

    @Id
    private String eventKey;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id")
    private User student;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private StudentGroup group;

    private GoogleCalendarLessonBinding(User teacher, String eventKey, User student, StudentGroup group) {
        this.teacher = teacher;
        this.eventKey = eventKey;
        this.student = student;
        this.group = group;
    }

    public static GoogleCalendarLessonBinding create(User teacher, String eventKey, User student) {
        return new GoogleCalendarLessonBinding(teacher, eventKey, student, null);
    }

    public static GoogleCalendarLessonBinding createForGroup(User teacher, String eventKey, StudentGroup group) {
        return new GoogleCalendarLessonBinding(teacher, eventKey, null, group);
    }

    public void changeStudent(User student) {
        if (student == null) throw new IllegalArgumentException("Student is required");
        this.student = student;
        this.group = null;
    }

    public void changeGroup(StudentGroup group) {
        if (group == null) throw new IllegalArgumentException("Group is required");
        this.group = group;
        this.student = null;
    }

    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Key implements Serializable {
        private UUID teacher;
        private String eventKey;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Key key)) return false;
            return Objects.equals(teacher, key.teacher) && Objects.equals(eventKey, key.eventKey);
        }

        @Override
        public int hashCode() {
            return Objects.hash(teacher, eventKey);
        }
    }
}
