package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only instructor diagnostics grounded in current provider information,
 * server-held permissions and sanitized browser-reported incident categories.
 *
 * <p>The LiveKit microphone track is observable, but who physically muted it
 * is not. Client reports are clues, not proof of the root cause.
 */
@Service
public class KolinClassDiagnosticsService {
    static final Set<String> CATEGORIES = Set.of(
        "MEDIA_AUTHORIZATION", "MEDIA_SIGNALING", "MEDIA_NETWORK",
        "MEDIA_DEVICES", "MEDIA_UNKNOWN", "CONNECTION_LOST",
        "PDF_RENDER", "TRANSCRIPTION_START", "AUDIO_FOCUS"
    );
    private static final int MAX_PUPILS = 16;
    private static final int MAX_INCIDENTS = 18;
    private static final Duration INCIDENT_WINDOW = Duration.ofMinutes(45);
    private static final Duration DEDUPE_WINDOW = Duration.ofSeconds(20);
    private static final Duration RETENTION = Duration.ofDays(7);
    private final OnlineClassAccessService access;
    private final OnlineClassParticipantRepository participants;
    private final KolinTaskRoster roster;
    private final LiveClassMediaProvider media;
    private final KolinDiagnosticEventRepository incidents;
    private final Clock clock;

    public KolinClassDiagnosticsService(OnlineClassAccessService access,
                                        OnlineClassParticipantRepository participants,
                                        KolinTaskRoster roster, LiveClassMediaProvider media,
                                        KolinDiagnosticEventRepository incidents, Clock clock) {
        this.access = access;
        this.participants = participants;
        this.roster = roster;
        this.media = media;
        this.incidents = incidents;
        this.clock = clock;
    }

    /** Authenticated participant reports only one fixed category, never a raw error. */
    @Transactional
    public void report(AuthenticatedUser actor, UUID classId, String category) {
        OnlineClass room = access.requireAdmitted(actor, classId);
        if (!CATEGORIES.contains(category)) throw new IllegalArgumentException("Unsupported diagnostic category");
        Instant now = clock.instant();
        if (!incidents.existsByOnlineClassIdAndUserIdAndCategoryAndRecordedAtAfter(
                classId, actor.id(), category, now.minus(DEDUPE_WINDOW))) {
            incidents.save(KolinDiagnosticEvent.of(room, actor.id(), category, now));
        }
        // Retain privacy-safe incident categories for 7 days at most.
        incidents.deleteByRecordedAtBefore(now.minus(RETENTION));
    }

    /** Independently reauthorize even when called from the private Kolyn chat. */
    @Transactional(readOnly = true)
    public Map<String, Object> read(AuthenticatedUser teacher, OnlineClass room, String question) {
        access.requireHost(teacher, room.getId());
        Instant now = clock.instant();
        boolean mediaQuestion = isMediaQuestion(question);
        Set<UUID> allowed = new HashSet<>();
        Map<UUID, String> names = new HashMap<>();
        for (var pupil : roster.read(room).stream().limit(MAX_PUPILS).toList()) {
            allowed.add(pupil.id());
            names.put(pupil.id(), pupil.name());
        }
        allowed.add(teacher.id());
        names.put(teacher.id(), "Преподаватель");

        List<LiveClassMediaProvider.MediaParticipant> live = List.of();
        String providerState = mediaQuestion ? "unavailable" : "not_queried_not_needed";
        if (mediaQuestion) {
            if (!media.isConfigured()) {
                providerState = "not_configured";
            } else {
                try {
                    live = media.listParticipantMedia(room.getRoomName());
                    providerState = "observed";
                } catch (RuntimeException unavailable) {
                    providerState = "unavailable";
                }
            }
        }
        Map<UUID, LiveClassMediaProvider.MediaParticipant> observed = new HashMap<>();
        for (var item : live) {
            UUID identity = ParticipantIdentity.userId(item.identity()).orElse(null);
            if (identity != null && allowed.contains(identity)) observed.put(identity, item);
        }

        List<Map<String, Object>> statuses = new ArrayList<>();
        for (var participant : participants.findAllByOnlineClassIdOrderByCreatedAtAsc(room.getId())) {
            UUID id = participant.getUser().getId();
            if (!allowed.contains(id) || participant.getAdmissionState() == AdmissionState.REMOVED) continue;
            var row = new LinkedHashMap<String, Object>();
            row.put("name", names.get(id));
            row.put("role", id.equals(teacher.id()) ? "teacher" : "student");
            row.put("microphonePermissionAllowed", participant.isMicrophoneEnabled());
            row.put("lastJoinedAt", participant.getLastJoinedAt() == null ? null : participant.getLastJoinedAt().toString());
            row.put("lastLeftAt", participant.getLastLeftAt() == null ? null : participant.getLastLeftAt().toString());
            row.put("attendanceConnectionHint", participant.isConnected());
            if (mediaQuestion && "observed".equals(providerState)) {
                var track = observed.get(id);
                row.put("providerConnected", track != null);
                row.put("microphoneTrackStatus", track == null ? "not_connected"
                        : !track.microphonePublished() ? "not_published"
                        : track.microphoneMuted() ? "muted" : "published_unmuted");
            } else {
                row.put("microphoneTrackStatus", "not_checked");
            }
            statuses.add(row);
        }

        List<Map<String, Object>> recent = new ArrayList<>();
        try {
            for (var incident : incidents.findTop30ByOnlineClassIdAndRecordedAtAfterOrderByRecordedAtDesc(
                    room.getId(), now.minus(INCIDENT_WINDOW))) {
                if (recent.size() >= MAX_INCIDENTS) break;
                UUID source = incident.getUserId();
                if (!allowed.contains(source) || !CATEGORIES.contains(incident.getCategory())) continue;
                recent.add(Map.of(
                    "participant", names.get(source),
                    "category", incident.getCategory(),
                    "recordedAt", incident.getRecordedAt().toString(),
                    "evidence", "browser_reported_category_not_verified_root_cause"
                ));
            }
        } catch (RuntimeException ignored) {
            // A diagnostic failure must not interrupt the lesson itself.
        }
        var out = new LinkedHashMap<String, Object>();
        out.put("observedAt", now.toString());
        out.put("liveKitObservation", providerState);
        out.put("participants", statuses);
        out.put("recentClientErrors", recent);
        out.put("transcriptionState", room.getTranscriptionState().name());
        out.put("recordingState", room.getRecordingState().name());
        out.put("note", "A published/muted track is an observed LiveKit status. Mic permission is a server policy, " +
            "NOT the student's device switch. Neither proves who switched a microphone off. " +
            "A client error category is a report, NOT proof of a system-wide outage. " +
            "No raw provider logs, audio signal levels or device permissions are available. " +
            "If liveKitObservation is unavailable, never assume anyone is online or muted.");
        return out;
    }

    private static boolean isMediaQuestion(String text) {
        String q = text.toLowerCase(Locale.ROOT);
        return q.matches("(?su).*(?:микроф|звук|аудио|мьют|mute|mic|audio|тон|слыш|ошиб|сбой|problem|error|network|сети|подключ|соедин|пропал|отключ|камер|camera|transcri|транскрип).*");
    }
}
