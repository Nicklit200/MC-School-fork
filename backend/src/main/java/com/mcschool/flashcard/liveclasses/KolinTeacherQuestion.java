package com.mcschool.flashcard.liveclasses;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/** A privacy-minimised audit row for a teacher question sent to Kolin. */
@Entity
@Table(name = "kolin_teacher_questions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class KolinTeacherQuestion {

    public enum Status { RECEIVED, ANSWERED, FAILED }

    @Id
    private UUID id;

    @Column(name = "class_id", nullable = false)
    private UUID classId;

    @Column(name = "teacher_id", nullable = false)
    private UUID teacherId;

    @Column(name = "client_message_id")
    private UUID clientMessageId;

    @Column(name = "question_text", nullable = false, columnDefinition = "text")
    private String questionText;

    @Column(name = "target_type", nullable = false, length = 16)
    private String targetType;

    @Column(name = "student_id")
    private UUID studentId;

    @Column(name = "current_workbook_page")
    private Integer currentWorkbookPage;

    @Column(length = 16)
    private String format;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "processed_at")
    private Instant processedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private KolinTeacherQuestion(UUID classId, UUID teacherId, UUID clientMessageId,
                                 String questionText, String targetType, UUID studentId,
                                 Integer currentWorkbookPage, String format) {
        this.id = UUID.randomUUID();
        this.classId = Objects.requireNonNull(classId);
        this.teacherId = Objects.requireNonNull(teacherId);
        this.clientMessageId = clientMessageId;
        this.questionText = Objects.requireNonNull(questionText);
        this.targetType = Objects.requireNonNull(targetType);
        this.studentId = studentId;
        this.currentWorkbookPage = currentWorkbookPage;
        this.format = format;
        this.status = Status.RECEIVED;
    }

    public static KolinTeacherQuestion received(UUID classId, UUID teacherId, UUID clientMessageId,
                                                String questionText, String targetType, UUID studentId,
                                                Integer currentWorkbookPage, String format) {
        return new KolinTeacherQuestion(classId, teacherId, clientMessageId, questionText,
                targetType, studentId, currentWorkbookPage, format);
    }

    public void markAnswered() {
        status = Status.ANSWERED;
        processedAt = Instant.now();
    }

    public void markFailed() {
        if (status == Status.ANSWERED) return;
        status = Status.FAILED;
        processedAt = Instant.now();
    }
}
