package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Real PostgreSQL / Flyway checks: server exit hook is the only producer,
 * and the owner receives at most one email when final speech is absent.
 */
@TestPropertySource(properties = {
        "app.online-classes.transcript-alert-sweep-initial-ms=86400000"
})
class TranscriptExitAlertIntegrationTest extends AbstractIntegrationTest {

    @Autowired private TranscriptExitAlertService alerts;
    @Autowired private OnlineClassRepository classes;
    @Autowired private OnlineClassParticipantRepository participants;
    @Autowired private OnlineClassTranscriptSegmentRepository segments;
    @Autowired private UserRepository users;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private NotificationService notifications;

    private User teacher;
    private User student;
    private OnlineClass room;

    @BeforeEach
    void setUp() {
        Instant future = Instant.now().plus(7, ChronoUnit.DAYS);
        teacher = users.save(User.invitedTeacher("Jeyla", "jeyla@test.local", "t1", future));
        student = users.save(User.invitedStudent("Maxim", "maxim@test.local", teacher, "s1", future));
        Instant started = Instant.now().minus(25, ChronoUnit.MINUTES);
        room = OnlineClass.forStudent(teacher, "local-alert-test", "local-alert-test",
                "Максим", started, started.plus(1, ChronoUnit.HOURS), student);
        room.start(started);
        room = classes.save(room);
    }

    @Test
    void doesNotQueuePupilExit() {
        alerts.scheduleForHost(student.getId(), room.getId());
        assertThat(numberOfJobs()).isZero();
        verify(notifications, never()).sendOwnerMissingTranscript(anyString(), anyString());
    }

    @Test
    void skipsClassWithoutVerifiedTeacherAndPupilAttendance() {
        alerts.scheduleForHost(teacher.getId(), room.getId());
        makeDue();
        alerts.checkDue(room.getId());

        assertThat(status()).isEqualTo("SKIPPED");
        verify(notifications, never()).sendOwnerMissingTranscript(anyString(), anyString());
    }

    @Test
    void oneSavedSpeechSegmentSuppressesWarning() {
        addAttendance();
        segments.save(OnlineClassTranscriptSegment.finalSegment(
                room, "soniox-1", "speaker-1", student, "Maxim",
                "ru", 1000, 3000, "Привет!", 0.97));
        alerts.scheduleForHost(teacher.getId(), room.getId());
        makeDue();
        alerts.checkDue(room.getId());

        assertThat(status()).isEqualTo("OK");
        verify(notifications, never()).sendOwnerMissingTranscript(anyString(), anyString());
    }

    @Test
    void missingTranscriptTriggersOneOwnerEmailAfterSecondCheck() {
        addAttendance();
        when(notifications.sendOwnerMissingTranscript(anyString(), anyString())).thenReturn(true);

        alerts.scheduleForHost(teacher.getId(), room.getId());
        // Repeated click on Exit / End must not create a second pending job.
        alerts.scheduleForHost(teacher.getId(), room.getId());
        assertThat(numberOfJobs()).isEqualTo(1);
        makeDue();
        alerts.checkDue(room.getId());
        assertThat(status()).isEqualTo("PENDING");
        verify(notifications, never()).sendOwnerMissingTranscript(anyString(), anyString());

        makeDue();
        alerts.checkDue(room.getId());
        assertThat(status()).isEqualTo("SENT");
        alerts.scheduleForHost(teacher.getId(), room.getId());
        alerts.checkDue(room.getId());
        assertThat(numberOfJobs()).isEqualTo(1);
        verify(notifications, times(1)).sendOwnerMissingTranscript(anyString(), anyString());
    }

    @Test
    void failedDeliveryRemainsPendingAndRetries() {
        addAttendance();
        when(notifications.sendOwnerMissingTranscript(anyString(), anyString()))
                .thenReturn(false, true);

        alerts.scheduleForHost(teacher.getId(), room.getId());
        makeDue();
        alerts.checkDue(room.getId());
        makeDue();
        alerts.checkDue(room.getId());
        assertThat(status()).isEqualTo("PENDING");

        makeDue();
        alerts.checkDue(room.getId());
        assertThat(status()).isEqualTo("SENT");
        verify(notifications, times(2)).sendOwnerMissingTranscript(anyString(), anyString());
    }

    private void addAttendance() {
        Instant joined = Instant.now().minus(12, ChronoUnit.MINUTES);
        Instant left = Instant.now().minus(1, ChronoUnit.MINUTES);
        OnlineClassParticipant host = OnlineClassParticipant.host(room, teacher);
        host.markJoined(joined);
        host.markLeft(left);
        OnlineClassParticipant pupil = OnlineClassParticipant.student(room, student);
        pupil.admit();
        pupil.markJoined(joined);
        pupil.markLeft(left);
        participants.save(host);
        participants.save(pupil);
    }

    private int numberOfJobs() {
        Integer value = jdbc.queryForObject(
                "SELECT count(*) FROM online_class_transcript_exit_alerts", Integer.class);
        return value == null ? 0 : value;
    }

    private void makeDue() {
        jdbc.update("""
                UPDATE online_class_transcript_exit_alerts
                SET check_after = now() - interval '1 minute'
                WHERE class_id = ?
                """, room.getId());
    }

    private String status() {
        return jdbc.queryForObject(
                "SELECT status FROM online_class_transcript_exit_alerts WHERE class_id = ?",
                String.class, room.getId());
    }
}
