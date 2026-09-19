package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Retention sweeps and explicit deletion, including storage-failure retry. */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.class-storage.transcript-retention-days=30"
})
class ClassRetentionIntegrationTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.now();

    @Autowired
    private ClassRetentionService retentionService;

    @Autowired
    private OnlineClassRecordingRepository recordingRepository;

    @Autowired
    private OnlineClassTranscriptSegmentRepository transcriptRepository;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private UserRepository userRepository;

    @MockitoBean
    private ClassArtifactStorage storage;

    private User teacher;
    private User student;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local",
                "t1", NOW.plusSeconds(3600)));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local",
                teacher, "s1", NOW.plusSeconds(3600)));
        onlineClass = classRepository.save(OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", NOW.minus(2, ChronoUnit.HOURS), NOW.minus(1, ChronoUnit.HOURS), student));
        when(storage.isConfigured()).thenReturn(true);
    }

    private OnlineClassRecording readyRecording(Instant deleteAfter) {
        OnlineClassRecording recording = OnlineClassRecording.request(onlineClass, teacher, NOW);
        recording.markStarting("egress-" + java.util.UUID.randomUUID());
        recording.markReady("classes/x/recording.mp4", "video/mp4", 100L, 60L, NOW, deleteAfter);
        return recordingRepository.saveAndFlush(recording);
    }

    // --- Recording retention -------------------------------------------------

    @Test
    void anExpiredRecordingIsDeletedFromStorageAndMarked() {
        OnlineClassRecording recording = readyRecording(NOW.minus(1, ChronoUnit.DAYS));

        var result = retentionService.sweepRecordings();

        assertThat(result.recordingsDeleted()).isEqualTo(1);
        org.mockito.Mockito.verify(storage).delete("classes/x/recording.mp4");
        OnlineClassRecording reloaded = recordingRepository.findById(recording.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(RecordingStatus.DELETED);
        assertThat(reloaded.getDeletedAt()).isNotNull();
        // The key is cleared so nothing later tries to sign a URL for it.
        assertThat(reloaded.getStorageObjectKey()).isNull();
    }

    @Test
    void aRecordingInsideItsRetentionWindowIsUntouched() {
        readyRecording(NOW.plus(30, ChronoUnit.DAYS));

        assertThat(retentionService.sweepRecordings().recordingsDeleted()).isZero();
        // isConfigured() is legitimately called; what must not happen is a delete.
        org.mockito.Mockito.verify(storage, org.mockito.Mockito.never()).delete(anyString());
    }

    @Test
    void aFailedStorageDeleteLeavesTheRowForTheNextSweep() {
        OnlineClassRecording recording = readyRecording(NOW.minus(1, ChronoUnit.DAYS));
        doThrow(new MediaProviderException("storage down")).when(storage).delete(anyString());

        var result = retentionService.sweepRecordings();

        assertThat(result.recordingsFailed()).isEqualTo(1);
        // Never mark it gone when the object may still exist: that would orphan
        // the file with no record pointing at it.
        OnlineClassRecording reloaded = recordingRepository.findById(recording.getId()).orElseThrow();
        assertThat(reloaded.getDeletedAt()).isNull();
        assertThat(reloaded.getStatus()).isEqualTo(RecordingStatus.READY);
    }

    @Test
    void aRetriedSweepSucceedsOnceStorageRecovers() {
        readyRecording(NOW.minus(1, ChronoUnit.DAYS));
        doThrow(new MediaProviderException("storage down")).when(storage).delete(anyString());
        assertThat(retentionService.sweepRecordings().recordingsFailed()).isEqualTo(1);

        org.mockito.Mockito.reset(storage);
        when(storage.isConfigured()).thenReturn(true);

        assertThat(retentionService.sweepRecordings().recordingsDeleted()).isEqualTo(1);
    }

    @Test
    void anAlreadyDeletedRecordingIsNotSweptAgain() {
        OnlineClassRecording recording = readyRecording(NOW.minus(1, ChronoUnit.DAYS));
        retentionService.sweepRecordings();
        org.mockito.Mockito.reset(storage);
        when(storage.isConfigured()).thenReturn(true);

        assertThat(retentionService.sweepRecordings().recordingsDeleted()).isZero();
        org.mockito.Mockito.verify(storage, org.mockito.Mockito.never()).delete(anyString());
        assertThat(recordingRepository.findById(recording.getId()).orElseThrow().getDeletedAt())
                .isNotNull();
    }

    @Test
    void sweepingIsANoOpWhenStorageIsNotConfigured() {
        when(storage.isConfigured()).thenReturn(false);
        readyRecording(NOW.minus(1, ChronoUnit.DAYS));

        assertThat(retentionService.sweepRecordings().recordingsDeleted()).isZero();
    }

    // --- Transcript retention ------------------------------------------------

    @Test
    void transcriptsPastRetentionAreCleared() {
        onlineClass.end(NOW.minus(90, ChronoUnit.DAYS));
        classRepository.saveAndFlush(onlineClass);
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(
                onlineClass, "seg-1", "identity", student, "Student", "de", 0, 1000, "text", 0.9));

        assertThat(retentionService.sweepTranscripts().transcriptsDeleted()).isEqualTo(1);
        assertThat(transcriptRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(
                onlineClass.getId())).isEmpty();
    }

    @Test
    void aRecentTranscriptIsKept() {
        onlineClass.end(NOW.minus(1, ChronoUnit.DAYS));
        classRepository.saveAndFlush(onlineClass);
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(
                onlineClass, "seg-1", "identity", student, "Student", "de", 0, 1000, "text", 0.9));

        assertThat(retentionService.sweepTranscripts().transcriptsDeleted()).isZero();
        assertThat(transcriptRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(
                onlineClass.getId())).hasSize(1);
    }

    @Test
    void clearingATranscriptKeepsTheClassAndItsAttendance() {
        onlineClass.end(NOW.minus(90, ChronoUnit.DAYS));
        classRepository.saveAndFlush(onlineClass);
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(
                onlineClass, "seg-1", "identity", student, "Student", "de", 0, 1000, "text", 0.9));

        retentionService.sweepTranscripts();

        // Attendance is an educational record with a longer life than the
        // transcript, so the class row survives.
        assertThat(classRepository.findById(onlineClass.getId())).isPresent();
    }

    // --- Explicit deletion ---------------------------------------------------

    @Test
    void explicitDeletionRemovesEveryArtifactForAClass() {
        readyRecording(NOW.plus(30, ChronoUnit.DAYS));
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(
                onlineClass, "seg-1", "identity", student, "Student", "de", 0, 1000, "text", 0.9));

        assertThat(retentionService.deleteClassArtifacts(onlineClass.getId())).isTrue();

        assertThat(transcriptRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(
                onlineClass.getId())).isEmpty();
        assertThat(recordingRepository.findAllByOnlineClassIdOrderByRequestedAtDesc(
                onlineClass.getId()))
                .allMatch(recording -> recording.getDeletedAt() != null);
    }

    @Test
    void explicitDeletionReportsIncompleteWhenStorageFails() {
        readyRecording(NOW.plus(30, ChronoUnit.DAYS));
        doThrow(new MediaProviderException("storage down")).when(storage).delete(anyString());

        // Reported as incomplete so the caller knows an external object may
        // still exist, rather than being told deletion succeeded.
        assertThat(retentionService.deleteClassArtifacts(onlineClass.getId())).isFalse();
    }
}
