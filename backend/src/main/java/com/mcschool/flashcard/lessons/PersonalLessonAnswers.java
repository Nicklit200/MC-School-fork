package com.mcschool.flashcard.lessons;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Teacher-only answer keys are deliberately stored apart from pupil-facing workbooks. */
@Entity
@Table(name = "personal_lesson_answers", uniqueConstraints = @UniqueConstraint(
        name = "uq_personal_lesson_answers", columnNames = {"teacher_id", "event_id", "student_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PersonalLessonAnswers {
    @Id
    private UUID id;
    @Column(name = "teacher_id", nullable = false)
    private UUID teacherId;
    @Column(name = "event_id", nullable = false, length = 255)
    private String eventId;
    @Column(name = "student_id", nullable = false)
    private UUID studentId;
    @Column(nullable = false, length = 255)
    private String filename;
    @Column(name = "answers_pdf", nullable = false, columnDefinition = "bytea")
    private byte[] answersPdf;
    @Version
    @Column(nullable = false)
    private Long version;

    public static PersonalLessonAnswers create(UUID teacherId, String eventId, UUID studentId) {
        PersonalLessonAnswers answers = new PersonalLessonAnswers();
        answers.id = UUID.randomUUID();
        answers.teacherId = teacherId;
        answers.eventId = eventId;
        answers.studentId = studentId;
        return answers;
    }

    public void attach(String filename, byte[] pdf) {
        this.filename = filename;
        this.answersPdf = pdf;
    }

    public long documentVersion() { return version == null ? 1L : version + 1L; }
}
