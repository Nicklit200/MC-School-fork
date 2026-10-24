package com.mcschool.flashcard.notebookcamera;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.LessonHistoryEntry;
import com.mcschool.flashcard.lessons.LessonHistoryRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Uses only a disposable database; never falls back to a developer's local database. */
@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
@TestPropertySource(properties = "app.online-classes.enabled=true")
class NotebookCameraPersistenceIntegrationTest {
    private static final User TEACHER = activeTeacher();
    @Container
    private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private NotebookCameraService service;
    @Autowired private NotebookCameraRepository cameras;
    @Autowired private UserRepository users;
    @Autowired private LessonHistoryRepository lessons;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private LiveClassMediaProvider media;

    private static User activeTeacher() {
        User teacher = User.invitedTeacher("Camera teacher", "camera-teacher@test.local", "camera-teacher-invite", Instant.now().plusSeconds(3600));
        teacher.activate("not-a-production-password-hash");
        return teacher;
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username", DATABASE::getUsername);
        properties.add("spring.datasource.password", DATABASE::getPassword);
        properties.add("app.online-classes.pilot-owner-id", () -> TEACHER.getId().toString());
    }

    @Test
    void migrationAndAtomicClaimSurviveConcurrentRequestsAndReplacement() throws Exception {
        User teacher = users.save(TEACHER);
        User student = User.invitedStudent("Camera pupil", "camera-pupil@test.local", teacher,
                "camera-pupil-invite", Instant.now().plusSeconds(3600));
        student.enableManagedStudent();
        student = users.save(student);
        Instant now = Instant.now();
        lessons.save(LessonHistoryEntry.create(teacher, new GroupLessonResponse(
                "camera-concurrency-lesson", "camera-concurrency-lesson", null, null,
                student.getId(), student.getFullName(), List.of(student.getId()), "Camera test",
                now, now.plusSeconds(3600), null, null)));
        when(media.isConfigured()).thenReturn(true);
        when(media.createConnection(anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(call -> new ParticipantConnection("wss://test.invalid", "test-token",
                        call.getArgument(1), call.getArgument(0), Instant.now().plus(call.<Duration>getArgument(4))));
        AuthenticatedUser caller = new AuthenticatedUser(student.getId(), null, student.getRole());
        var pairing = service.create(caller, "camera-concurrency-lesson", null, null);
        CountDownLatch start = new CountDownLatch(1);
        Callable<Boolean> claim = () -> {
            start.await(10, TimeUnit.SECONDS);
            try {
                service.claim(pairing.camera().cameraId(), pairing.pairingToken());
                return true;
            } catch (ResourceNotFoundException alreadyUsed) {
                return false;
            }
        };
        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(claim);
            var second = pool.submit(claim);
            start.countDown();
            assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
        } finally {
            pool.shutdownNow();
        }
        NotebookCamera claimed = cameras.findById(pairing.camera().cameraId()).orElseThrow();
        assertThat(claimed.getClaimedAt()).isNotNull();
        assertThat(claimed.getPairingTokenHash()).isNull();
        assertThat(claimed.getSessionTokenHash()).hasSize(64);
        var replacement = service.create(caller, "camera-concurrency-lesson", null, null);
        assertThat(replacement.camera().cameraId()).isNotEqualTo(pairing.camera().cameraId());
        assertThat(cameras.findById(claimed.getId()).orElseThrow().getRevokedAt()).isNotNull();
        verify(media).closeRoom(claimed.getRoomName());
        assertThatThrownBy(() -> service.claim(pairing.camera().cameraId(), pairing.pairingToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        // PostgreSQL, not just an application check, prevents a second current
        // pairing for one lesson owner. Revoked historical rows coexist above.
        UUID duplicateId = UUID.randomUUID();
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO notebook_cameras
                    (id, teacher_id, event_id, owner_id, room_name, pairing_token_hash,
                     pairing_expires_at, session_expires_at, created_at)
                SELECT ?, teacher_id, event_id, owner_id, ?, pairing_token_hash,
                       pairing_expires_at, session_expires_at, created_at
                FROM notebook_cameras WHERE id = ?
                """, duplicateId, "notebook-" + duplicateId, replacement.camera().cameraId()))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("""
                UPDATE notebook_cameras
                SET created_at = now() - interval '10 minutes',
                    pairing_expires_at = now() - interval '5 minutes'
                WHERE id = ?
                """, replacement.camera().cameraId());
        assertThatThrownBy(() -> service.claim(replacement.camera().cameraId(), replacement.pairingToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        service.closeExpiredAndUnauthorized();
        assertThat(cameras.findById(replacement.camera().cameraId()).orElseThrow().getRevokedAt()).isNotNull();
    }
}
