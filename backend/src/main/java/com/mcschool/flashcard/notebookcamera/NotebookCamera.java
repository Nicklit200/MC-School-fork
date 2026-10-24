package com.mcschool.flashcard.notebookcamera;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One bounded phone pairing, in its own media room; never an attendance participant. */
@Entity
@Table(name = "notebook_cameras")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class NotebookCamera {
    @Id
    private UUID id;
    @Column(nullable = false)
    private UUID teacherId;
    @Column(nullable = false, length = 255)
    private String eventId;
    @Column(nullable = false)
    private UUID ownerId;
    private UUID classId;
    @Column(nullable = false, unique = true, length = 80)
    private String roomName;
    @Column(length = 64)
    private String pairingTokenHash;
    @Column(length = 64)
    private String sessionTokenHash;
    @Column(nullable = false)
    private Instant pairingExpiresAt;
    @Column(nullable = false)
    private Instant sessionExpiresAt;
    @Column(nullable = false)
    private Instant createdAt;
    private Instant claimedAt;
    private Instant revokedAt;
    private Instant roomClosedAt;
    @Version
    private Long version;

    static NotebookCamera create(UUID teacherId, String eventId, UUID ownerId, UUID classId,
                                 String pairingHash, Instant now, Instant pairingExpiry,
                                 Instant sessionExpiry) {
        NotebookCamera camera = new NotebookCamera();
        camera.id = UUID.randomUUID();
        camera.teacherId = teacherId;
        camera.eventId = eventId;
        camera.ownerId = ownerId;
        camera.classId = classId;
        camera.roomName = "notebook-" + camera.id;
        camera.pairingTokenHash = pairingHash;
        camera.createdAt = now;
        camera.pairingExpiresAt = pairingExpiry;
        camera.sessionExpiresAt = sessionExpiry;
        return camera;
    }

    boolean isActive(Instant now) {
        return revokedAt == null && now.isBefore(sessionExpiresAt)
                && (claimedAt != null || now.isBefore(pairingExpiresAt));
    }

    void claim(String sessionHash, Instant now) {
        pairingTokenHash = null;
        sessionTokenHash = sessionHash;
        claimedAt = now;
    }

    void revoke(Instant now) {
        if (revokedAt == null) revokedAt = now;
        pairingTokenHash = null;
        sessionTokenHash = null;
    }

    void roomClosed(Instant now) { roomClosedAt = now; }
}
