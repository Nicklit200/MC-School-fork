package com.mcschool.flashcard.lessonboard;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "lesson_board_operations")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LessonBoardOperation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "teacher_id", nullable = false)
    private UUID teacherId;

    @Column(name = "event_id", length = 255, nullable = false)
    private String eventId;

    @Column(name = "actor_id", nullable = false)
    private UUID actorId;

    @Column(nullable = false, length = 16)
    private String kind;

    @Column(nullable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    private LessonBoardOperation(UUID teacherId, String eventId, UUID actorId, String kind, String payload) {
        this.teacherId = teacherId;
        this.eventId = eventId;
        this.actorId = actorId;
        this.kind = kind;
        this.payload = payload;
        this.createdAt = Instant.now();
    }

    public static LessonBoardOperation create(UUID teacherId, String eventId, UUID actorId,
                                              String kind, String payload) {
        return new LessonBoardOperation(teacherId, eventId, actorId, kind, payload);
    }
}
