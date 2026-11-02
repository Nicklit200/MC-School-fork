package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Physical owning-teacher presence, never inferred from a token or another pupil. */
@Service
public class TeacherPresenceService {
    private static final Duration DISCOVERY_TTL = Duration.ofSeconds(3);
    private static final int MAX_DISCOVERY_ENTRIES = 512;
    private final LiveClassMediaProvider media;
    private final Clock clock;
    private final ConcurrentHashMap<UUID, Snapshot> discovery = new ConcurrentHashMap<>();

    private record Snapshot(boolean present, Instant expiresAt) {}

    public TeacherPresenceService(LiveClassMediaProvider media) {
        this(media, Clock.systemUTC());
    }

    @Autowired
    public TeacherPresenceService(LiveClassMediaProvider media, Clock clock) {
        this.media = media;
        this.clock = clock;
    }

    /** Token issuance and admission always check the current provider snapshot. */
    public boolean current(OnlineClass room) {
        if (room == null || !room.isConnectable() || room.isTerminal()) return false;
        try {
            return hasTeacher(room, media.listParticipantIdentities(room.getRoomName()));
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    public boolean discovery(OnlineClass room) {
        return discovery(room, false);
    }

    /** Connected host is only a probe hint: the provider must still confirm its identity. */
    public boolean discovery(OnlineClass room, boolean hostConnectedHint) {
        if (room == null || !room.isConnectable() || room.isTerminal()
                || (room.getEmptySince() != null && !hostConnectedHint)) return false;
        Instant at = clock.instant();
        Snapshot cached = discovery.get(room.getId());
        if (cached != null && at.isBefore(cached.expiresAt())) return cached.present();
        boolean present = current(room);
        if (discovery.size() >= MAX_DISCOVERY_ENTRIES) discovery.clear();
        discovery.put(room.getId(), new Snapshot(present, at.plus(DISCOVERY_TTL)));
        return present;
    }

    /** Only server-fetched media identities may be supplied here. */
    public static boolean hasTeacher(OnlineClass room, List<String> identities) {
        if (room == null || room.getTeacher() == null || room.getTeacher().getId() == null || identities == null) return false;
        UUID teacherId = room.getTeacher().getId();
        return identities.stream().anyMatch(identity -> ParticipantIdentity.userId(identity)
                .filter(teacherId::equals).isPresent());
    }
}
