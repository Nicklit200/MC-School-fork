package com.mcschool.flashcard.cards;

import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.homeworks.Homework;
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
import java.time.LocalDate;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A single flashcard: one question and its correct answer, owned by one student
 * and created by that student's teacher. The spaced-repetition state
 * ({@link #repetitionNumber}, {@link #dueDate}, {@link #status}) is advanced by
 * {@link com.mcschool.flashcard.study.Sm2Scheduler} and applied through
 * {@link #applyScheduling}.
 */
@Entity
@Table(name = "cards")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Card {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by_teacher_id", nullable = false)
    private User createdByTeacher;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "homework_id", nullable = false)
    private Homework homework;

    @Column(nullable = false, length = 1000)
    private String question;

    @Column(name = "correct_answer", nullable = false, length = 500)
    private String correctAnswer;

    @Column(name = "wrong_answer1", length = 500)
    private String wrongAnswer1;

    @Column(name = "wrong_answer2", length = 500)
    private String wrongAnswer2;

    @Column(name = "wrong_answer3", length = 500)
    private String wrongAnswer3;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private CardStatus status;

    @Column(name = "repetition_number", nullable = false)
    private int repetitionNumber;

    /** Next day this card must be reviewed. */
    @Column(name = "due_date")
    private LocalDate dueDate;

    /**
     * Optional time limit (seconds) the teacher sets for answering this card in a
     * session. {@code null} means no limit. Enforced by the study UI as a countdown.
     */
    @Column(name = "time_limit_seconds")
    private Integer timeLimitSeconds;

    /**
     * Soft-delete flag. An archived card is hidden from all lists and study, but the
     * row is kept so study-session history that references it stays intact.
     */
    @Column(nullable = false)
    private boolean archived;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private Card(Homework homework, User createdByTeacher, String question, String correctAnswer,
                 String wrongAnswer1, String wrongAnswer2, String wrongAnswer3) {
        this.id = UUID.randomUUID();
        this.homework = homework;
        this.student = homework.getStudent();
        this.createdByTeacher = createdByTeacher;
        this.question = question;
        this.correctAnswer = correctAnswer;
        this.wrongAnswer1 = wrongAnswer1;
        this.wrongAnswer2 = wrongAnswer2;
        this.wrongAnswer3 = wrongAnswer3;
        this.status = CardStatus.ACTIVE;
        this.repetitionNumber = 0;
        // New homework cards first become due on the homework's start date.
        this.dueDate = homework.getStartDate();
    }

    public static Card create(Homework homework, User createdByTeacher, String question, String correctAnswer) {
        return new Card(homework, createdByTeacher, question.strip(), correctAnswer.strip(), null, null, null);
    }

    public static Card createImported(Homework homework, User createdByTeacher, String question, String correctAnswer,
                                      String wrongAnswer1, String wrongAnswer2, String wrongAnswer3) {
        return new Card(homework, createdByTeacher, question.strip(), correctAnswer.strip(),
                wrongAnswer1.strip(), wrongAnswer2.strip(), wrongAnswer3.strip());
    }

    /** Teacher edits the question and/or answer; the review schedule is left untouched. */
    public void edit(String question, String correctAnswer) {
        this.question = question.strip();
        this.correctAnswer = correctAnswer.strip();
    }

    /** Sets (or clears, with {@code null}) the per-card answer time limit in seconds. */
    public void changeTimeLimit(Integer timeLimitSeconds) {
        this.timeLimitSeconds = timeLimitSeconds;
    }

    /** Soft-deletes the card: it disappears from lists and study but the row is kept. */
    public void archive() {
        this.archived = true;
    }

    /** Applies a new spaced-repetition state after a successful scheduled review. */
    public void applyScheduling(int repetitionNumber, LocalDate dueDate, CardStatus status) {
        this.repetitionNumber = repetitionNumber;
        this.dueDate = dueDate;
        this.status = status;
    }

    /** Pilot/testing helper: makes the card due without changing its learning state. */
    public void markDueOn(LocalDate dueDate) {
        this.dueDate = dueDate;
    }

    public boolean hasSavedWrongAnswers() {
        return wrongAnswer1 != null && wrongAnswer2 != null && wrongAnswer3 != null;
    }

    public boolean isDueOn(LocalDate day) {
        if (status != CardStatus.ACTIVE || dueDate == null || dueDate.isAfter(day)) {
            return false;
        }
        return repetitionNumber > 0 || !homework.getStartDate().isAfter(day);
    }
}
