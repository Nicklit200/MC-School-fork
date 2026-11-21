package com.mcschool.flashcard.liveclasses;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Lightweight server-side delivery queue. No global lesson polling: only
 * classIds explicitly queued by a teacher's Leave / End for all action.
 */
@Component
public class TranscriptExitAlertScheduler {
    private static final Logger log = LoggerFactory.getLogger(TranscriptExitAlertScheduler.class);
    private final JdbcTemplate jdbc;
    private final TranscriptExitAlertService service;
    private final Clock clock;

    public TranscriptExitAlertScheduler(JdbcTemplate jdbc, TranscriptExitAlertService service, Clock clock) {
        this.jdbc = jdbc;
        this.service = service;
        this.clock = clock;
    }

    @Scheduled(
            fixedDelayString = "${app.online-classes.transcript-alert-sweep-ms:15000}",
            initialDelayString = "${app.online-classes.transcript-alert-sweep-initial-ms:15000}")
    public void sweep() {
        List<UUID> due;
        try {
            due = jdbc.query("""
                    SELECT class_id
                    FROM online_class_transcript_exit_alerts
                    WHERE status = 'PENDING' AND check_after <= ?
                    ORDER BY check_after
                    LIMIT 50
                    """, (rs, index) -> rs.getObject(1, UUID.class),
                    Timestamp.from(clock.instant()));
        } catch (RuntimeException e) {
            log.error("Could not read pending transcript exit alerts; will retry", e);
            return;
        }
        for (UUID classId : due) {
            try {
                service.checkDue(classId);
            } catch (RuntimeException e) {
                // A failed DB query must not prevent other classes from being
                // checked on this tick.
                log.error("Transcript exit audit failed; will retry: classId={}", classId, e);
            }
        }
    }
}
