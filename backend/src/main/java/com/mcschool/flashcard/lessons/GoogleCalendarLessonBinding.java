package com.mcschool.flashcard.lessons;

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

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    private GoogleCalendarLessonBinding(User teacher, String eventKey, User student) {
        this.teacher = teacher;
        this.eventKey = eventKey;
        this.student = student;
    }

    public static GoogleCalendarLessonBinding create(User teacher, String eventKey, User student) {
        return new GoogleCalendarLessonBinding(teacher, eventKey, student);
    }

    public void changeStudent(User student) {
        this.student = student;
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
