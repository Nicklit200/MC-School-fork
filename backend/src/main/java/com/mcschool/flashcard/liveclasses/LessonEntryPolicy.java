package com.mcschool.flashcard.liveclasses;

import java.time.Duration;
import java.time.DayOfWeek;
import java.time.temporal.TemporalAdjusters;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/** Student calendar admission is independent of the owning teacher's unrestricted re-entry. */
public final class LessonEntryPolicy {
    public static final ZoneId ZONE = ZoneId.of("Europe/Berlin");

    private LessonEntryPolicy() {}

    public static LocalDate lessonDate(Instant scheduledStart) {
        return scheduledStart.atZone(ZONE).toLocalDate();
    }

    public static Instant dayStart(Instant scheduledStart) {
        return lessonDate(scheduledStart).atStartOfDay(ZONE).toInstant();
    }

    public static Instant dayEnd(Instant scheduledStart) {
        // Calendar arithmetic, not +24h: Berlin has 23h and 25h DST days.
        return lessonDate(scheduledStart).plusDays(1).atStartOfDay(ZONE).toInstant();
    }

    public static boolean isLessonDay(Instant scheduledStart, Instant now) {
        return !now.isBefore(dayStart(scheduledStart)) && now.isBefore(dayEnd(scheduledStart));
    }

    /** Monday 00:00 Berlin after the week containing the scheduled lesson. */
    public static Instant weekEnd(Instant scheduledStart) {
        return lessonDate(scheduledStart).with(TemporalAdjusters.next(DayOfWeek.MONDAY))
                .atStartOfDay(ZONE).toInstant();
    }

    public static boolean weekExpired(OnlineClass room, Instant now) {
        return !now.isBefore(weekEnd(room.getScheduledStartAt()));
    }

    public static boolean returning(OnlineClass room, OnlineClassParticipant participant) {
        // Admission alone is not a previous entry. markJoined is only reached
        // after a successful, authorized connection-token request.
        return participant != null && participant.isAdmitted() &&
                (isOwningHost(room, participant) || (participant.getFirstJoinedAt() != null
                    && isLessonDay(room.getScheduledStartAt(), participant.getFirstJoinedAt())));
    }

    public static boolean canEnter(OnlineClass room, OnlineClassParticipant participant, Instant now) {
        return canEnter(room, participant, now, isOwningHost(room, participant));
    }

    /** verifiedHost comes only from the access service, including before a host row exists. */
    public static boolean canEnter(OnlineClass room, OnlineClassParticipant participant,
                                   Instant now, boolean verifiedHost) {
        if (!room.isConnectable() || room.isTerminal()) return false;
        if (participant != null && (participant.getAdmissionState() == AdmissionState.REMOVED
                || participant.getAdmissionState() == AdmissionState.REJECTED)) return false;
        if (verifiedHost) return true;
        if (weekExpired(room, now)) return false;
        return isLessonDay(room.getScheduledStartAt(), now)
                || (!now.isBefore(dayEnd(room.getScheduledStartAt())) && returning(room, participant));
    }

    /** The current classroom flow admits pupils whenever their actual teacher is present. */
    public static boolean canEnter(OnlineClass room, OnlineClassParticipant participant,
                                   Instant now, boolean verifiedHost, boolean teacherPresent) {
        if (!room.isConnectable() || room.isTerminal() || blocked(participant)) return false;
        return verifiedHost || teacherPresent;
    }

    public static String state(OnlineClass room, OnlineClassParticipant participant, Instant now) {
        return state(room, participant, now, isOwningHost(room, participant));
    }

    public static String state(OnlineClass room, OnlineClassParticipant participant,
                               Instant now, boolean verifiedHost) {
        if (room.isTerminal()) return "ENDED";
        if (verifiedHost) {
            if (!room.isConnectable()) return "WAITING_FOR_TEACHER";
            if (!canEnter(room, participant, now, true)) return "CLOSED";
            return isLessonDay(room.getScheduledStartAt(), now) ? "OPEN" : "RECONNECT";
        }
        // The student's calendar window may expire while the durable lesson
        // remains open for its teacher. Only an explicit terminal state is End.
        if (weekExpired(room, now)) return "DAY_CLOSED";
        if (canEnter(room, participant, now)) {
            return isLessonDay(room.getScheduledStartAt(), now) ? "OPEN" : "RECONNECT";
        }
        if (!isLessonDay(room.getScheduledStartAt(), now)) return "DAY_CLOSED";
        if (!room.isConnectable()) return "WAITING_FOR_TEACHER";
        return "CLOSED";
    }

    public static String state(OnlineClass room, OnlineClassParticipant participant,
                               Instant now, boolean verifiedHost, boolean teacherPresent) {
        if (room.isTerminal()) return "ENDED";
        if (blocked(participant)) return "CLOSED";
        if (!room.isConnectable()) return "WAITING_FOR_TEACHER";
        if (verifiedHost) return isLessonDay(room.getScheduledStartAt(), now) ? "OPEN" : "RECONNECT";
        if (!teacherPresent) return "WAITING_FOR_TEACHER";
        return hasJoined(room, participant) ? "RECONNECT" : "OPEN";
    }

    /** Actual authorized attendance also counts when the owner opened on a different day. */
    public static boolean hasJoined(OnlineClass room, OnlineClassParticipant participant) {
        return participant != null && participant.isAdmitted() && participant.getFirstJoinedAt() != null
                && participant.getOnlineClass() != null
                && room.getId().equals(participant.getOnlineClass().getId());
    }

    public static Duration tokenTtl(OnlineClass room, OnlineClassParticipant participant,
                                    Instant now, Duration configured) {
        return tokenTtl(room, participant, now, configured, isOwningHost(room, participant));
    }

    public static Duration tokenTtl(OnlineClass room, OnlineClassParticipant participant,
                                    Instant now, Duration configured, boolean verifiedHost) {
        if (verifiedHost) return configured;
        Duration ttl = configured.compareTo(Duration.between(now, weekEnd(room.getScheduledStartAt()))) < 0
                ? configured : Duration.between(now, weekEnd(room.getScheduledStartAt()));
        if (!returning(room, participant)) {
            Duration remaining = Duration.between(now, dayEnd(room.getScheduledStartAt()));
            if (remaining.compareTo(ttl) < 0) ttl = remaining;
        }
        return ttl;
    }

    public static Duration tokenTtl(OnlineClass room, OnlineClassParticipant participant,
                                    Instant now, Duration configured, boolean verifiedHost, boolean teacherPresent) {
        if (!canEnter(room, participant, now, verifiedHost, teacherPresent)
                || configured == null || configured.isNegative() || configured.isZero()) return Duration.ZERO;
        // Presence is checked afresh before issuing this short configured token;
        // an unrelated scheduled date must not make its lifetime negative.
        return configured;
    }

    private static boolean blocked(OnlineClassParticipant participant) {
        return participant != null && (participant.getAdmissionState() == AdmissionState.REMOVED
                || participant.getAdmissionState() == AdmissionState.REJECTED);
    }

    private static boolean isOwningHost(OnlineClass room, OnlineClassParticipant participant) {
        return participant != null && participant.isHost()
                && participant.getOnlineClass() != null
                && room.getId().equals(participant.getOnlineClass().getId())
                && participant.getUser() != null && participant.getUser().getId() != null
                && room.getTeacher().getId().equals(participant.getUser().getId());
    }
}
