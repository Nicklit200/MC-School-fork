package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.lessons.PostLessonHomeworkPilotAccess;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** Durable phone pushes for terminal post-lesson homework jobs. */
@Service
public class PostLessonHomeworkPushService {
    private static final Logger LOG = LoggerFactory.getLogger(PostLessonHomeworkPushService.class);
    private static final int MAX_ATTEMPTS = 6;

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final PushSubscriptionRepository subscriptions;
    private final WebPushService webPush;
    private final PostLessonHomeworkPilotAccess pilot;

    public PostLessonHomeworkPushService(JdbcTemplate jdbc, UserRepository users,
            PushSubscriptionRepository subscriptions, WebPushService webPush,
            PostLessonHomeworkPilotAccess pilot) {
        this.jdbc = jdbc;
        this.users = users;
        this.subscriptions = subscriptions;
        this.webPush = webPush;
        this.pilot = pilot;
    }

    record Delivery(UUID id, UUID jobId, UUID recipientId, UUID subscriptionId, String eventState,
            Instant finishedAt, int attempts) {}

    record Result(String state, Instant finishedAt, UUID teacherId, String eventId,
            String title, int days, int generatedFiles) {}

    /**
     * Call after committing a terminal job state. Each device has a unique receipt.
     * The periodic scan also repairs failures between commit and capturing the event.
     */
    public void captureTerminal(UUID jobId) {
        if (!pilot.enabled()) return;
        if (pilot.allTeachersEnabled()) {
            jdbc.update("""
            INSERT INTO post_lesson_homework_push_outbox
                (id, job_id, recipient_id, subscription_id, event_state, event_finished_at)
            SELECT gen_random_uuid(), j.id, u.id, s.id, j.state, j.finished_at
              FROM post_lesson_homework_jobs j
              JOIN users u ON u.id = j.teacher_id AND u.role = 'TEACHER'
              JOIN push_subscriptions s ON s.user_id = u.id
             WHERE j.id = ?
               AND j.state IN ('PUBLISHED', 'FAILED')
               AND j.finished_at IS NOT NULL
               AND u.status = 'ACTIVE'
               AND u.archived = false
            ON CONFLICT (job_id, subscription_id, event_state, event_finished_at) DO NOTHING
            """, jobId);
            return;
        }
        jdbc.update("""
             INSERT INTO post_lesson_homework_push_outbox
                 (id, job_id, recipient_id, subscription_id, event_state, event_finished_at)
             SELECT gen_random_uuid(), j.id, u.id, s.id, j.state, j.finished_at
               FROM post_lesson_homework_jobs j
               JOIN users u ON u.id = j.teacher_id AND u.role = 'TEACHER'
               JOIN push_subscriptions s ON s.user_id = u.id
              WHERE j.id = ? AND j.teacher_id = ?
                AND j.state IN ('PUBLISHED', 'FAILED')
                AND j.finished_at IS NOT NULL
                AND u.status = 'ACTIVE'
                AND u.archived = false
             ON CONFLICT (job_id, subscription_id, event_state, event_finished_at) DO NOTHING
            """, jobId, pilot.teacherId());
    }

    @Scheduled(fixedDelayString = "${app.post-lesson-homework.push.poll-ms:5000}",
            initialDelayString = "${app.post-lesson-homework.push.initial-ms:12000}")
    public void sendPending() {
        if (!webPush.isConfigured() || !pilot.enabled()) return;
        try {
            // Only recent jobs are scanned to avoid replaying old school assignments
            // when the feature is first deployed; existing outbox retries persist.
            List<UUID> recent = pilot.allTeachersEnabled()
                    ? jdbc.query("""
                        SELECT id FROM post_lesson_homework_jobs
                         WHERE state IN ('PUBLISHED', 'FAILED')
                           AND finished_at >= now() - INTERVAL '24 hours'
                         ORDER BY finished_at DESC LIMIT 80
                        """, (rs, i) -> rs.getObject("id", UUID.class))
                    : jdbc.query("""
                        SELECT id FROM post_lesson_homework_jobs
                         WHERE state IN ('PUBLISHED', 'FAILED')
                           AND teacher_id = ?
                           AND finished_at >= now() - INTERVAL '24 hours'
                         ORDER BY finished_at DESC LIMIT 80
                        """, (rs, i) -> rs.getObject("id", UUID.class), pilot.teacherId());
            for (UUID jobId : recent) captureTerminal(jobId);
            jdbc.update("""
                    UPDATE post_lesson_homework_push_outbox
                       SET status = 'PENDING', lease_until = NULL
                     WHERE status = 'DELIVERING' AND lease_until < now()
                    """);
            for (int i = 0; i < 5; i++) {
                Delivery next = claim();
                if (next == null) break;
                sendOne(next);
            }
        } catch (RuntimeException error) {
            LOG.warn("Post-lesson push queue failed: {}", error.getClass().getSimpleName());
        }
    }

    private Delivery claim() {
        return jdbc.query("""
                UPDATE post_lesson_homework_push_outbox
                   SET status = 'DELIVERING', attempts = attempts + 1,
                       lease_until = now() + INTERVAL '90 seconds'
                 WHERE id = (
                   SELECT id FROM post_lesson_homework_push_outbox
                    WHERE status = 'PENDING' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at, created_at
                    FOR UPDATE SKIP LOCKED LIMIT 1
                 )
                RETURNING id, job_id, recipient_id, subscription_id, event_state,
                          event_finished_at, attempts
                """, (rs, index) -> row(rs)).stream().findFirst().orElse(null);
    }

    private static Delivery row(ResultSet rs) throws SQLException {
        return new Delivery(
                rs.getObject("id", UUID.class), rs.getObject("job_id", UUID.class),
                rs.getObject("recipient_id", UUID.class), rs.getObject("subscription_id", UUID.class),
                rs.getString("event_state"),
                rs.getTimestamp("event_finished_at").toInstant(), rs.getInt("attempts"));
    }

    private void sendOne(Delivery delivery) {
        try {
            Result result = currentResult(delivery.jobId());
            if (result == null
                    || !delivery.eventState().equals(result.state())
                    || !delivery.finishedAt().equals(result.finishedAt())) {
                mark(delivery.id(), "SKIPPED");
                return;
            }

            User recipient = users.findById(delivery.recipientId()).orElse(null);
            if (recipient == null || recipient.isArchived() || recipient.getStatus() != UserStatus.ACTIVE
                    || !pilot.allowed(result.teacherId())
                    || !pilot.allowed(recipient.getId())
                    || !isStaffRecipient(recipient.getId(), recipient.getRole(), result.teacherId())) {
                mark(delivery.id(), "SKIPPED");
                return;
            }

            PushSubscription subscription = subscriptions.findById(delivery.subscriptionId()).orElse(null);
            if (subscription == null || !subscription.getUser().getId().equals(recipient.getId())) {
                mark(delivery.id(), "SKIPPED");
                return;
            }
            String url = recipient.getRole() == Role.ADMIN
                    ? "/admin/teachers/" + result.teacherId() + "/lessons/" + encode(result.eventId())
                    : "/teacher/lessons/" + encode(result.eventId()) + "?reviewHomework=1";
            webPush.send(subscription, title(result), body(result), url,
                    "post-homework-" + delivery.jobId() + "-" + result.state());
            mark(delivery.id(), "SENT");
        } catch (RuntimeException failure) {
            int minutes = Math.min(60, 1 << Math.min(delivery.attempts() - 1, 6));
            if (delivery.attempts() >= MAX_ATTEMPTS) {
                mark(delivery.id(), "FAILED");
            } else {
                jdbc.update("""
                    UPDATE post_lesson_homework_push_outbox
                       SET status = 'PENDING', lease_until = NULL,
                           next_attempt_at = now() + (? * INTERVAL '1 minute')
                     WHERE id = ? AND status = 'DELIVERING'
                    """, minutes, delivery.id());
            }
            LOG.warn("Homework push failed job={} recipient={} attempt={} error={}",
                    delivery.jobId(), delivery.recipientId(), delivery.attempts(),
                    failure.getClass().getSimpleName());
        }
    }

    private Result currentResult(UUID jobId) {
        return jdbc.query("""
                SELECT state, finished_at, teacher_id, event_id, lesson_title,
                       days, generated_files
                  FROM post_lesson_homework_jobs WHERE id = ?
                """, (rs, i) -> new Result(
                    rs.getString("state"),
                    rs.getTimestamp("finished_at") == null ? null : rs.getTimestamp("finished_at").toInstant(),
                    rs.getObject("teacher_id", UUID.class), rs.getString("event_id"),
                    rs.getString("lesson_title"), rs.getInt("days"),
                    rs.getInt("generated_files")), jobId).stream().findFirst().orElse(null);
    }

    static boolean isStaffRecipient(UUID recipient, Role role, UUID teacher) {
        return role == Role.TEACHER && Objects.equals(recipient, teacher);
    }

    static String title(Result result) {
        return result.state().equals("PUBLISHED")
                ? "Mindcrafti: домашка назначена"
                : "Mindcrafti: ошибка домашки";
    }

    static String body(Result result) {
        String label = result.title();
        if (label.length() > 75) label = label.substring(0, 72) + "...";
        if ("PUBLISHED".equals(result.state())) {
            int pupils = result.days() > 0 ? result.generatedFiles() / result.days() : 0;
            return label + ": " + result.days() + " дн., " + pupils
                    + " уч. Домашка проверена и назначена.";
        }
        return label + ": назначение не завершено. Открой урок и нажми «Повторить».";
    }

    private void mark(UUID id, String status) {
        jdbc.update("""
                UPDATE post_lesson_homework_push_outbox
                   SET status = ?, lease_until = NULL,
                       sent_at = CASE WHEN ? = 'SENT' THEN now() ELSE sent_at END
                 WHERE id = ? AND status = 'DELIVERING'
                """, status, status, id);
    }

    private static String encode(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
