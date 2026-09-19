package com.mcschool.flashcard.liveclasses;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the retention sweeps.
 *
 * <p>Separate from {@link ClassRetentionService} so the sweep logic can be
 * tested directly without waiting on a schedule, and so a failing sweep is
 * contained here rather than escaping into the scheduler thread.
 */
@Component
public class ClassRetentionScheduler {

    private static final Logger log = LoggerFactory.getLogger(ClassRetentionScheduler.class);

    private final ClassRetentionService retentionService;
    private final OnlineClassProperties properties;

    public ClassRetentionScheduler(ClassRetentionService retentionService,
                                   OnlineClassProperties properties) {
        this.retentionService = retentionService;
        this.properties = properties;
    }

    @Scheduled(
            cron = "${app.online-classes.retention.cron:0 30 3 * * *}",
            zone = "${app.online-classes.retention.zone:Europe/Berlin}")
    public void sweep() {
        if (!properties.enabled()) {
            return;
        }
        try {
            retentionService.sweepRecordings();
            retentionService.sweepTranscripts();
        } catch (RuntimeException e) {
            // A retention failure must never take down the scheduler or the
            // application; the next run retries.
            log.warn("Retention sweep failed; will retry on the next schedule");
        }
    }
}
