package com.mcschool.flashcard.study;

import com.mcschool.flashcard.cards.Card;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One card's progress within a {@link StudySession}. A card stays {@link ItemState#PENDING}
 * until answered correctly; a wrong answer flags {@link #hadWrongAttempt} and moves the
 * card to the back of the queue so it comes round again in the same session.
 */
@Entity
@Table(name = "study_session_items")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StudySessionItem {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private StudySession session;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false)
    private Card card;

    @Column(name = "queue_position", nullable = false)
    private int queuePosition;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ItemState state;

    @Column(name = "had_wrong_attempt", nullable = false)
    private boolean hadWrongAttempt;

    @Column(name = "first_selected_answer", columnDefinition = "TEXT")
    private String firstSelectedAnswer;

    @Column(name = "first_answer_correct")
    private Boolean firstAnswerCorrect;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    private StudySessionItem(StudySession session, Card card, int queuePosition) {
        this.id = UUID.randomUUID();
        this.session = session;
        this.card = card;
        this.queuePosition = queuePosition;
        this.state = ItemState.PENDING;
        this.hadWrongAttempt = false;
    }

    public static StudySessionItem create(StudySession session, Card card, int queuePosition) {
        return new StudySessionItem(session, card, queuePosition);
    }

    /** Stores the first answer only; later retries do not overwrite what the student chose first. */
    public void recordFirstAnswer(String selectedAnswer, boolean correct) {
        if (this.firstSelectedAnswer == null) {
            this.firstSelectedAnswer = selectedAnswer;
            this.firstAnswerCorrect = correct;
        }
    }

    public void markCorrect() {
        this.state = ItemState.ANSWERED_CORRECT;
    }

    /** Records a wrong attempt and sends the card to the back of the queue. */
    public void markWrongAndRequeue(int newQueuePosition) {
        this.hadWrongAttempt = true;
        this.queuePosition = newQueuePosition;
    }

    /** True if the student has never answered this card wrong in this session. */
    public boolean isFirstTryClean() {
        return !hadWrongAttempt;
    }
}
