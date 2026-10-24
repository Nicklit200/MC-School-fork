package com.mcschool.flashcard.notebookcamera;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.OnlineClassPilotAuthorizationManager;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.lessons.LessonHistoryEntry;
import com.mcschool.flashcard.lessons.LessonHistoryRepository;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaGrant;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

class NotebookCameraServiceTest {
    static final UUID TEACHER = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    static final UUID STUDENT = UUID.fromString("1a4f18d1-e145-4c27-bd3e-7d1598405045");
    static final String EVENT = "lesson-occurrence-1";
    static final Instant NOW = Instant.parse("2026-10-24T10:00:00Z");
    private NotebookCameraRepository cameras;
    private LessonHistoryRepository lessons;
    private UserRepository users;
    private StudentGroupMemberRepository groups;
    private OnlineClassAccessService classAccess;
    private OnlineClassPilotAuthorizationManager pilot;
    private LiveClassMediaProvider media;
    private Clock clock;
    private NotebookCameraService service;
    private final Map<UUID, NotebookCamera> stored = new LinkedHashMap<>();
    private LessonHistoryEntry lesson;
    private User teacher;
    private User student;

    @BeforeEach
    void setup() {
        cameras = mock(NotebookCameraRepository.class);
        lessons = mock(LessonHistoryRepository.class);
        users = mock(UserRepository.class);
        groups = mock(StudentGroupMemberRepository.class);
        classAccess = mock(OnlineClassAccessService.class);
        pilot = mock(OnlineClassPilotAuthorizationManager.class);
        media = mock(LiveClassMediaProvider.class);
        clock = mock(Clock.class);
        when(clock.instant()).thenReturn(NOW);
        when(media.isConfigured()).thenReturn(true);
        when(pilot.isEnabledForTeacher(TEACHER)).thenReturn(true);
        teacher = account(TEACHER, Role.TEACHER, null);
        student = account(STUDENT, Role.STUDENT, teacher);
        lesson = mock(LessonHistoryEntry.class);
        when(lesson.getTeacher()).thenReturn(teacher);
        when(lesson.getEventId()).thenReturn(EVENT);
        when(lesson.getStudentId()).thenReturn(STUDENT);
        when(lessons.findByTeacherIdAndEventId(TEACHER, EVENT)).thenReturn(Optional.of(lesson));
        when(lessons.findLockedByTeacherIdAndEventId(TEACHER, EVENT)).thenReturn(Optional.of(lesson));
        when(cameras.save(any())).thenAnswer(invocation -> {
            NotebookCamera camera = invocation.getArgument(0);
            stored.put(camera.getId(), camera);
            return camera;
        });
        when(cameras.findLockedById(any())).thenAnswer(invocation -> Optional.ofNullable(stored.get(invocation.getArgument(0))));
        when(cameras.findAllByTeacherIdAndEventIdAndRevokedAtIsNullOrderByCreatedAtAsc(TEACHER, EVENT))
                .thenAnswer(invocation -> stored.values().stream().filter(c -> c.getRevokedAt() == null).toList());
        when(cameras.findAllByRevokedAtIsNull())
                .thenAnswer(invocation -> stored.values().stream().filter(c -> c.getRevokedAt() == null).toList());
        when(cameras.findAllByRevokedAtNotNullAndRoomClosedAtIsNull())
                .thenAnswer(invocation -> stored.values().stream().filter(c -> c.getRevokedAt() != null && c.getRoomClosedAt() == null).toList());
        when(cameras.findAllByClassIdAndRevokedAtIsNull(any()))
                .thenAnswer(invocation -> stored.values().stream()
                        .filter(c -> invocation.getArgument(0).equals(c.getClassId()) && c.getRevokedAt() == null).toList());
        when(media.createConnection(anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> new ParticipantConnection("wss://media.invalid", "test-media-jwt",
                        invocation.getArgument(1), invocation.getArgument(0), NOW.plus(invocation.<Duration>getArgument(4))));
        service = new NotebookCameraService(cameras, lessons, users, groups, classAccess, pilot, media, clock);
    }

    private User account(UUID id, Role role, User ownerTeacher) {
        User user = mock(User.class);
        when(user.getId()).thenReturn(id);
        when(user.getRole()).thenReturn(role);
        when(user.getStatus()).thenReturn(UserStatus.ACTIVE);
        when(user.getFullName()).thenReturn(role.name());
        when(user.getTeacher()).thenReturn(ownerTeacher);
        when(users.findById(id)).thenReturn(Optional.of(user));
        return user;
    }

    private AuthenticatedUser caller(UUID id, Role role) { return new AuthenticatedUser(id, null, role); }
    private AuthenticatedUser studentCaller() { return caller(STUDENT, Role.STUDENT); }
    private AuthenticatedUser teacherCaller() { return caller(TEACHER, Role.TEACHER); }
    private NotebookCameraService.Pairing pairing() { return service.create(studentCaller(), EVENT, null, null); }

    @Test
    void pairAndClaimUseIndependentHashedSecretsAndSeparateRoom() {
        var pairing = pairing();
        NotebookCamera storedCamera = stored.get(pairing.camera().cameraId());
        assertThat(storedCamera.getPairingTokenHash()).hasSize(64).isNotEqualTo(pairing.pairingToken());
        assertThat(pairing.camera().pairingExpiresAt()).isEqualTo(NOW.plusSeconds(300));
        assertThat(pairing.camera().sessionExpiresAt()).isEqualTo(NOW.plus(Duration.ofHours(3)));
        var session = service.claim(storedCamera.getId(), pairing.pairingToken());
        assertThat(session.sessionToken()).hasSize(43).isNotEqualTo(pairing.pairingToken());
        assertThat(storedCamera.getSessionTokenHash()).hasSize(64).isNotEqualTo(session.sessionToken());
        assertThat(storedCamera.getPairingTokenHash()).isNull();
        assertThat(session.camera().status()).isEqualTo("CONNECTED");
        assertThat(session.connection().roomName()).startsWith("notebook-");
        assertThat(session.connection().identity()).isEqualTo("notebook-phone:" + storedCamera.getId());
        verify(media).createConnection(eq(storedCamera.getRoomName()), anyString(), anyString(),
                eq(new MediaGrant(true, false, false, true, true)), eq(Duration.ofMinutes(2)));
    }

    @Test
    void qrCannotBeClaimedTwiceOrUsedAsReconnectCredential() {
        var pairing = pairing();
        UUID id = pairing.camera().cameraId();
        service.claim(id, pairing.pairingToken());
        assertThatThrownBy(() -> service.claim(id, pairing.pairingToken())).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.phoneConnection(id, pairing.pairingToken())).isInstanceOf(ResourceNotFoundException.class);
        verify(media, times(1)).createConnection(anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void invalidOrExpiredQrNeverIssuesToken() {
        var pairing = pairing();
        assertThatThrownBy(() -> service.claim(pairing.camera().cameraId(), "x".repeat(43)))
                .isInstanceOf(ResourceNotFoundException.class);
        when(clock.instant()).thenReturn(NOW.plus(Duration.ofMinutes(5)));
        assertThatThrownBy(() -> service.claim(pairing.camera().cameraId(), pairing.pairingToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(media, never()).createConnection(anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void replacementRevokesOldQrAndSessionAndClosesOldRoom() {
        var first = pairing();
        var session = service.claim(first.camera().cameraId(), first.pairingToken());
        var second = pairing();
        assertThat(second.camera().cameraId()).isNotEqualTo(first.camera().cameraId());
        assertThatThrownBy(() -> service.phoneConnection(first.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.claim(first.camera().cameraId(), first.pairingToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(media).closeRoom(stored.get(first.camera().cameraId()).getRoomName());
        verify(lessons, times(2)).findLockedByTeacherIdAndEventId(TEACHER, EVENT);
    }

    @Test
    void studentCannotCreateOrWatchAnotherPupilsCamera() {
        UUID otherId = UUID.randomUUID();
        account(otherId, Role.STUDENT, teacher);
        assertThatThrownBy(() -> service.create(studentCaller(), EVENT, otherId, null))
                .isInstanceOf(ResourceNotFoundException.class);
        var pairing = pairing();
        UUID group = UUID.randomUUID();
        when(lesson.getGroupId()).thenReturn(group);
        when(groups.existsByGroupIdAndStudentId(group, otherId)).thenReturn(true);
        assertThat(service.list(caller(otherId, Role.STUDENT), EVENT)).isEmpty();
        assertThatThrownBy(() -> service.viewerConnection(caller(otherId, Role.STUDENT), pairing.camera().cameraId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.revoke(caller(otherId, Role.STUDENT), pairing.camera().cameraId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void teacherMayPairOnlyTheirExactLessonAndAssignedStudents() {
        UUID outsider = UUID.randomUUID();
        account(outsider, Role.STUDENT, teacher);
        assertThatThrownBy(() -> service.create(teacherCaller(), EVENT, outsider, null))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.create(teacherCaller(), "unknown-event", STUDENT, null))
                .isInstanceOf(ResourceNotFoundException.class);
        var pairing = service.create(teacherCaller(), EVENT, STUDENT, null);
        assertThat(pairing.camera().ownerId()).isEqualTo(STUDENT);
        assertThat(service.list(teacherCaller(), EVENT)).hasSize(1);
    }

    @Test
    void viewerCanPublishDataButCannotPublishAudioVideoOrScreen() {
        var pairing = pairing();
        var connection = service.viewerConnection(teacherCaller(), pairing.camera().cameraId());
        ArgumentCaptor<MediaGrant> grant = ArgumentCaptor.forClass(MediaGrant.class);
        verify(media).createConnection(anyString(), anyString(), anyString(), grant.capture(), any());
        assertThat(grant.getValue().canPublishData()).isTrue();
        assertThat(grant.getValue().canSubscribe()).isTrue();
        assertThat(grant.getValue().canPublishCamera()).isFalse();
        assertThat(grant.getValue().canPublishMicrophone()).isFalse();
        assertThat(grant.getValue().canPublishScreenShare()).isFalse();
        assertThat(grant.getValue().canPublishAnything()).isFalse();
        assertThat(connection.identity()).startsWith("notebook-viewer:");
    }

    @Test
    void phoneSessionIsBoundToCameraAndExpiresAtThreeHours() {
        var first = pairing();
        var session = service.claim(first.camera().cameraId(), first.pairingToken());
        var teacherPairing = service.create(teacherCaller(), EVENT, null, null);
        assertThatThrownBy(() -> service.phoneConnection(teacherPairing.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        service.phoneConnection(first.camera().cameraId(), session.sessionToken());
        when(clock.instant()).thenReturn(NOW.plus(Duration.ofHours(3)));
        assertThatThrownBy(() -> service.phoneConnection(first.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void ownerMembershipAndActiveStatusAreRecheckedOnRefresh() {
        var pairing = pairing();
        var session = service.claim(pairing.camera().cameraId(), pairing.pairingToken());
        when(lesson.getStudentId()).thenReturn(UUID.randomUUID());
        assertThatThrownBy(() -> service.phoneConnection(pairing.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        when(lesson.getStudentId()).thenReturn(STUDENT);
        when(student.isArchived()).thenReturn(true);
        assertThatThrownBy(() -> service.phoneConnection(pairing.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void disablingPilotAlsoBlocksPhoneCredentialsWithoutAccountJwt() {
        var pairing = pairing();
        var session = service.claim(pairing.camera().cameraId(), pairing.pairingToken());
        when(pilot.isEnabledForTeacher(TEACHER)).thenReturn(false);
        assertThatThrownBy(() -> service.phoneConnection(pairing.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        service.closeExpiredAndUnauthorized();
        verify(media).closeRoom(stored.get(pairing.camera().cameraId()).getRoomName());
    }

    @Test
    void revokeInvalidatesSessionAndDisconnectsEveryLiveIdentity() {
        var pairing = pairing();
        var session = service.claim(pairing.camera().cameraId(), pairing.pairingToken());
        String room = session.connection().roomName();
        when(media.listParticipantIdentities(room)).thenReturn(List.of(session.connection().identity(), "notebook-viewer:one"));
        service.revoke(teacherCaller(), pairing.camera().cameraId());
        verify(media).removeParticipant(room, session.connection().identity());
        verify(media).removeParticipant(room, "notebook-viewer:one");
        verify(media).closeRoom(room);
        assertThatThrownBy(() -> service.phoneConnection(pairing.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void expiryClosesAlreadyConnectedStreamAndOutageIsRetried() {
        var pairing = pairing();
        var session = service.claim(pairing.camera().cameraId(), pairing.pairingToken());
        NotebookCamera camera = stored.get(pairing.camera().cameraId());
        when(clock.instant()).thenReturn(NOW.plus(Duration.ofHours(3)));
        doThrow(new MediaProviderException("offline")).doNothing().when(media).closeRoom(camera.getRoomName());
        service.closeExpiredAndUnauthorized();
        assertThat(camera.getRevokedAt()).isNotNull();
        assertThatThrownBy(() -> service.phoneConnection(camera.getId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        service.closeExpiredAndUnauthorized();
        assertThat(camera.getRoomClosedAt()).isNotNull();
        verify(media, times(2)).closeRoom(camera.getRoomName());
    }

    @Test
    void classEndAndRemovalDenyNewTokensAndCloseCameraImmediately() {
        UUID classId = UUID.randomUUID();
        OnlineClass onlineClass = mock(OnlineClass.class);
        when(onlineClass.getTeacher()).thenReturn(teacher);
        when(onlineClass.getEventId()).thenReturn(EVENT);
        when(onlineClass.isConnectable()).thenReturn(true);
        when(classAccess.requireAdmitted(studentCaller(), classId)).thenReturn(onlineClass);
        var pairing = service.create(studentCaller(), EVENT, null, classId);
        var session = service.claim(pairing.camera().cameraId(), pairing.pairingToken());
        when(onlineClass.isConnectable()).thenReturn(false);
        assertThatThrownBy(() -> service.phoneConnection(pairing.camera().cameraId(), session.sessionToken()))
                .isInstanceOf(ResourceNotFoundException.class);
        service.revokeClass(classId);
        verify(media).closeRoom(session.connection().roomName());
        assertThat(stored.get(pairing.camera().cameraId()).getSessionTokenHash()).isNull();
    }

    @Test
    void wrongClassOrUnadmittedOwnerCannotReceivePairing() {
        UUID classId = UUID.randomUUID();
        when(classAccess.requireAdmitted(studentCaller(), classId)).thenThrow(new ResourceNotFoundException("not admitted"));
        assertThatThrownBy(() -> service.create(studentCaller(), EVENT, null, classId))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(cameras, never()).save(any());
    }

    @Test
    void unavailableMediaDoesNotIssuePairingOrLeakProviderError() {
        when(media.isConfigured()).thenReturn(false);
        assertThatThrownBy(this::pairing).isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                        .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        when(media.isConfigured()).thenReturn(true);
        var pairing = pairing();
        doThrow(new MediaProviderException("secret-upstream-details")).when(media).ensureRoom(anyString());
        assertThatThrownBy(() -> service.claim(pairing.camera().cameraId(), pairing.pairingToken()))
                .isInstanceOf(ConflictException.class).hasMessageNotContaining("secret-upstream-details");
    }
}
