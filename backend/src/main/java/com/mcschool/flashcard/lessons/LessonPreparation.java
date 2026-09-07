package com.mcschool.flashcard.lessons;

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
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "lesson_preparations")
@IdClass(LessonPreparation.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LessonPreparation {

    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private User teacher;

    @Id
    @Column(name = "event_id", nullable = false, length = 255)
    private String eventId;

    @Column(name = "homework_notes", columnDefinition = "text")
    private String homeworkNotes;

    @Column(name = "difficulties", columnDefinition = "text")
    private String difficulties;

    @Column(name = "lesson_plan", columnDefinition = "text")
    private String lessonPlan;

    @Column(name = "workbook_pdf", columnDefinition = "bytea")
    private byte[] workbookPdf;

    @Column(name = "workbook_filename", length = 255)
    private String workbookFilename;

    @Column(name = "answers_pdf", columnDefinition = "bytea")
    private byte[] answersPdf;

    @Column(name = "answers_filename", length = 255)
    private String answersFilename;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private LessonPreparation(User teacher, String eventId) {
        this.teacher = teacher;
        this.eventId = eventId;
    }

    public static LessonPreparation create(User teacher, String eventId) {
        return new LessonPreparation(teacher, eventId);
    }

    public void updateNotes(String homeworkNotes, String difficulties, String lessonPlan) {
        this.homeworkNotes = normalize(homeworkNotes);
        this.difficulties = normalize(difficulties);
        this.lessonPlan = normalize(lessonPlan);
    }

    public void attachWorkbook(String filename, byte[] pdf) {
        this.workbookFilename = filename;
        this.workbookPdf = pdf;
    }

    public void attachAnswers(String filename, byte[] pdf) {
        this.answersFilename = filename;
        this.answersPdf = pdf;
    }

    public boolean hasWorkbook() {
        return workbookPdf != null && workbookPdf.length > 0;
    }

    public boolean hasAnswers() {
        return answersPdf != null && answersPdf.length > 0;
    }

    private String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
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
