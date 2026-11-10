package com.mcschool.flashcard.liveclasses;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

/** Only an allowlisted category and server timestamp. Never raw device error text. */
@Entity
@Table(name = "kolyn_lesson_diagnostic_events")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class KolinDiagnosticEvent {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "class_id", nullable = false)
    private OnlineClass onlineClass;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(name = "category", nullable = false, length = 40)
    private String category;
    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    public static KolinDiagnosticEvent of(OnlineClass room, UUID userId, String category, Instant at) {
        var event = new KolinDiagnosticEvent();
        event.id = UUID.randomUUID();
        event.onlineClass = room;
        event.userId = userId;
        event.category = category;
        event.recordedAt = at;
        return event;
    }
}
