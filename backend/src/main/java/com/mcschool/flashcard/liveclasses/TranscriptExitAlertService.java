package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.notifications.NotificationService;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Durable, event-triggered transcript audit. Only the owning teacher's explicit
 * Leave / End-for-all request creates a pending job. A short settle period lets
 * the Soniox worker flush final segments before an owner-only email is sent.
 */
@Service
public class TranscriptExitAlertService {
    private static final Logger log = LoggerFactory.getLogger(TranscriptExitAlertService.class);
    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
    private static final DateTimeFormatter LESSON_TIME = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm");
    private static final Duration FIRST_DELAY = Duration.ofSeconds(90);
    private static final Duration SECOND_DELAY = Duration.ofSeconds(120);
    private static final Duration EMAIL_RETRY = Duration.ofMinutes(5);
    private static final long MIN_ATTENDANCE_SECONDS = 60;

    private final JdbcTemplate jdbc;
    private final OnlineClassRepository classes;
    private final OnlineClassParticipantRepository participants;
    private final NotificationService notifications;
    private final Clock clock;

    public TranscriptExitAlertService(JdbcTemplate jdbc, OnlineClassRepository classes,
                                      OnlineClassParticipantRepository participants,
                                      NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.classes = classes;
        this.participants = participants;
        this.notifications = notifications;
        this.clock = clock;
    }

    /**
     * Called by the two classroom exit endpoints, AFTER the class lifecycle
     * transaction has committed. It is deliberately a no-op for pupil exits,
     * unrelated teachers, unstarted classes and synthetic test rooms.
     */
    @Transactional
    public void scheduleForHost(UUID callerId, UUID classId) {
        OnlineClass room = classes.findById(classId).orElse(null);
        if (room == null || !room.getTeacher().getId().equals(callerId)) return;
        if (room.getStatus() != OnlineClassStatus.LIVE
                && room.getStatus() != OnlineClassStatus.ENDED) return;
        if (room.getActualStartAt() == null || room.getEventId().startsWith("test-")) return;

        Instant checkAfter = clock.instant().plus(FIRST_DELAY);
        // A prior exit before any pupil joined must not suppress a later real
        // lesson. Re-arm only SKIPPED, never OK/SENT or already PENDING.
        jdbc.update("""
                INSERT INTO online_class_transcript_exit_alerts (class_id, status, check_after)
                VALUES (?, 'PENDING', ?)
                ON CONFLICT (class_id) DO UPDATE
                    SET status = 'PENDING',
                        check_after = EXCLUDED.check_after,
                        attempts = 0,
                        checked_at = NULL
                    WHERE online_class_transcript_exit_alerts.status = 'SKIPPED'
                """, classId, Timestamp.from(checkAfter));
    }

    /**
     * Invoked by the server's local sweep, never by a ChatGPT automation.
     * Row locking prevents two backend instances from emailing simultaneously.
     */
    @Transactional
    public void checkDue(UUID classId) {
        Instant now = clock.instant();
        List<Integer> locked = jdbc.query("""
                SELECT 1
                FROM online_class_transcript_exit_alerts
                WHERE class_id = ? AND status = 'PENDING' AND check_after <= ?
                FOR UPDATE SKIP LOCKED
                """, (rs, index) -> rs.getInt(1), classId, Timestamp.from(now));
        if (locked.isEmpty()) return;

        OnlineClass room = classes.findById(classId).orElse(null);
        if (room == null || room.getActualStartAt() == null
                || (room.getStatus() != OnlineClassStatus.LIVE
                    && room.getStatus() != OnlineClassStatus.ENDED)
                || !realTeacherAndPupilAttended(classId, now)) {
            complete(classId, "SKIPPED", now);
            return;
        }

        // Only nonblank FINAL segments count. Interim captions displayed in
        // the browser are not persisted and must not silence this alert.
        Boolean hasSavedSpeech = jdbc.queryForObject("""
                SELECT EXISTS(
                    SELECT 1 FROM online_class_transcript_segments
                    WHERE class_id = ? AND length(btrim(text)) > 0
                )
                """, Boolean.class, classId);
        if (Boolean.TRUE.equals(hasSavedSpeech)) {
            complete(classId, "OK", now);
            return;
        }

        Integer attempts = jdbc.queryForObject("""
                SELECT attempts FROM online_class_transcript_exit_alerts
                WHERE class_id = ?
                """, Integer.class, classId);
        if (attempts == null) return;
        if (attempts == 0) {
            // Independent second DB read avoids false positives caused by a
            // late final segment after the teacher has closed the room.
            jdbc.update("""
                    UPDATE online_class_transcript_exit_alerts
                    SET attempts = 1, check_after = ?, checked_at = ?
                    WHERE class_id = ?
                    """, Timestamp.from(now.plus(SECOND_DELAY)), Timestamp.from(now), classId);
            return;
        }

        String date = room.getScheduledStartAt().atZone(BERLIN).toLocalDate().toString();
        String target = room.getStudent() != null
                ? room.getStudent().getFullName()
                : room.getGroup() != null ? room.getGroup().getName() : "не указан";
        String subject = "Mindcrafti: не сохранилась транскрипция - " + date + " " + room.getTitle();
        String body = "На проведённом уроке Mindcrafti School не сохранилась ни одна реплика.\n\n"
                + "Преподаватель: " + room.getTeacher().getFullName() + "\n"
                + "Ученик / группа: " + target + "\n"
                + "Занятие: " + room.getTitle() + "\n"
                + "Начало по расписанию (Берлин): "
                + LESSON_TIME.format(room.getScheduledStartAt().atZone(BERLIN)) + "\n"
                + "eventId: " + room.getEventId() + "\n"
                + "classId: " + classId + "\n"
                + "Сохранённых реплик: 0\n\n"
                + "Проверьте запуск Soniox, соединение агента и доставку финальных реплик.\n\n"
                + "TRANSCRIPT_ALERT_EVENT_ID: " + room.getEventId();

        if (notifications.sendOwnerMissingTranscript(subject, body)) {
            jdbc.update("""
                    UPDATE online_class_transcript_exit_alerts
                    SET status = 'SENT', sent_at = ?, checked_at = ?, attempts = attempts + 1
                    WHERE class_id = ?
                    """, Timestamp.from(now), Timestamp.from(now), classId);
            log.warn("Owner-only transcript warning sent: classId={}", classId);
        } else {
            // No silent loss when Brevo is temporarily unavailable; disabled
            // mail in local environments also leaves the job pending.
            jdbc.update("""
                    UPDATE online_class_transcript_exit_alerts
                    SET attempts = attempts + 1, check_after = ?, checked_at = ?
                    WHERE class_id = ?
                    """, Timestamp.from(now.plus(EMAIL_RETRY)), Timestamp.from(now), classId);
            log.warn("Owner-only transcript warning delivery pending: classId={}", classId);
        }
    }

    private boolean realTeacherAndPupilAttended(UUID classId, Instant at) {
        boolean teacher = false;
        boolean pupil = false;
        for (OnlineClassParticipant participant
                : participants.findAllByOnlineClassIdOrderByCreatedAtAsc(classId)) {
            long seconds = observedSeconds(participant, at);
            if (participant.isHost() && seconds >= MIN_ATTENDANCE_SECONDS) teacher = true;
            if (!participant.isHost() && participant.isAdmitted()
                    && seconds >= MIN_ATTENDANCE_SECONDS) pupil = true;
        }
        return teacher && pupil;
    }

    static long observedSeconds(OnlineClassParticipant participant, Instant at) {
        long seconds = participant.getTotalConnectedSeconds();
        if (participant.isConnected() && participant.getLastJoinedAt() != null) {
            seconds += Math.max(0, Duration.between(participant.getLastJoinedAt(), at).getSeconds());
        }
        return seconds;
    }

    private void complete(UUID classId, String status, Instant at) {
        jdbc.update("""
                UPDATE online_class_transcript_exit_alerts
                SET status = ?, checked_at = ?
                WHERE class_id = ?
                """, status, Timestamp.from(at), classId);
    }
}
