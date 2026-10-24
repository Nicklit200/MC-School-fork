package com.mcschool.flashcard.notebookcamera;

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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The QR delegates only a bounded camera session, never the owner's account.
 * Every camera uses an isolated room so its video, ink and camera controls are
 * visible only to its owner and that lesson's teacher.
 */
@Service
public class NotebookCameraService {
    private static final Logger log = LoggerFactory.getLogger(NotebookCameraService.class);
    static final Duration PAIRING_TTL = Duration.ofMinutes(5);
    static final Duration SESSION_TTL = Duration.ofHours(3);
    static final Duration MEDIA_TOKEN_TTL = Duration.ofMinutes(2);
    static final MediaGrant PHONE_GRANT = new MediaGrant(true, false, false, true, true);
    static final MediaGrant VIEWER_GRANT = new MediaGrant(false, false, false, true, true);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final NotebookCameraRepository cameras;
    private final LessonHistoryRepository lessons;
    private final UserRepository users;
    private final StudentGroupMemberRepository groups;
    private final OnlineClassAccessService classAccess;
    private final OnlineClassPilotAuthorizationManager pilot;
    private final LiveClassMediaProvider media;
    private final Clock clock;

    public NotebookCameraService(NotebookCameraRepository cameras, LessonHistoryRepository lessons,
                                 UserRepository users, StudentGroupMemberRepository groups,
                                 OnlineClassAccessService classAccess,
                                 OnlineClassPilotAuthorizationManager pilot,
                                 LiveClassMediaProvider media, Clock clock) {
        this.cameras = cameras;
        this.lessons = lessons;
        this.users = users;
        this.groups = groups;
        this.classAccess = classAccess;
        this.pilot = pilot;
        this.media = media;
        this.clock = clock;
    }

    public record CameraView(UUID cameraId, String eventId, UUID ownerId, String ownerName,
                              UUID classId, String status, Instant pairingExpiresAt,
                              Instant sessionExpiresAt) {}
    public record Pairing(CameraView camera, String pairingToken) {}
    public record Connection(String serverUrl, String token, String identity, String roomName,
                              Instant expiresAt, String phoneIdentity) {
        static Connection of(ParticipantConnection connection, UUID id) {
            return new Connection(connection.serverUrl(), connection.token(), connection.identity(),
                    connection.roomName(), connection.expiresAt(), phoneIdentityFor(id));
        }
    }
    public record PhoneSession(CameraView camera, String sessionToken, Connection connection) {}

    @Transactional
    public Pairing create(AuthenticatedUser caller, String eventId, UUID studentId, UUID classId) {
        requireConfigured();
        LessonHistoryEntry authorized = requireLesson(caller, eventId);
        // Lock the occurrence even before there is a camera row. Concurrent QR
        // creation cannot leave two valid pairings for the same owner.
        LessonHistoryEntry lesson = lessons.findLockedByTeacherIdAndEventId(
                authorized.getTeacher().getId(), eventId).orElseThrow(NotebookCameraService::notFound);
        UUID ownerId = studentId == null ? caller.id() : studentId;
        if (caller.role() != Role.TEACHER && !caller.id().equals(ownerId)) throw notFound();
        User owner = requireActive(ownerId);
        requireAssigned(owner, lesson);
        requireClass(classId, principal(owner), lesson);

        cameras.findAllByTeacherIdAndEventIdAndRevokedAtIsNullOrderByCreatedAtAsc(
                lesson.getTeacher().getId(), eventId).stream()
                .filter(camera -> camera.getOwnerId().equals(ownerId))
                .map(camera -> cameras.findLockedById(camera.getId()).orElseThrow(NotebookCameraService::notFound))
                .forEach(this::revokeAndClose);
        // Release the partial unique index before inserting the replacement.
        cameras.flush();
        String token = secret();
        Instant now = clock.instant();
        NotebookCamera camera = NotebookCamera.create(lesson.getTeacher().getId(), eventId,
                ownerId, classId, hash(token), now, now.plus(PAIRING_TTL), now.plus(SESSION_TTL));
        cameras.save(camera);
        return new Pairing(view(camera, owner), token);
    }

    @Transactional(readOnly = true)
    public List<CameraView> list(AuthenticatedUser caller, String eventId) {
        LessonHistoryEntry lesson = requireLesson(caller, eventId);
        return cameras.findAllByTeacherIdAndEventIdAndRevokedAtIsNullOrderByCreatedAtAsc(
                        lesson.getTeacher().getId(), eventId).stream()
                .filter(camera -> caller.role() == Role.TEACHER || camera.getOwnerId().equals(caller.id()))
                .filter(camera -> camera.isActive(clock.instant()))
                .filter(this::stillAuthorized)
                .map(camera -> view(camera, requireActive(camera.getOwnerId())))
                .toList();
    }

    @Transactional
    public Connection viewerConnection(AuthenticatedUser caller, UUID cameraId) {
        requireConfigured();
        NotebookCamera camera = cameras.findLockedById(cameraId).orElseThrow(NotebookCameraService::notFound);
        requireViewer(caller, camera);
        requireCurrent(camera);
        return issue(camera, "notebook-viewer:" + cameraId + ":" + caller.id() + ":"
                + UUID.randomUUID().toString().substring(0, 8), requireActive(caller.id()).getFullName(), VIEWER_GRANT);
    }

    @Transactional
    public void revoke(AuthenticatedUser caller, UUID cameraId) {
        NotebookCamera camera = cameras.findLockedById(cameraId).orElseThrow(NotebookCameraService::notFound);
        requireViewer(caller, camera);
        revokeAndClose(camera);
    }

    @Transactional
    public PhoneSession claim(UUID cameraId, String token) {
        requireConfigured();
        // The row lock makes the single-use claim atomic across server instances.
        NotebookCamera camera = cameras.findLockedById(cameraId).orElseThrow(NotebookCameraService::notFound);
        if (camera.getClaimedAt() != null || !matches(token, camera.getPairingTokenHash())) throw notFound();
        User owner = requireCurrent(camera);
        String sessionToken = secret();
        camera.claim(hash(sessionToken), clock.instant());
        Connection connection = issue(camera, phoneIdentityFor(cameraId), owner.getFullName(), PHONE_GRANT);
        return new PhoneSession(view(camera, owner), sessionToken, connection);
    }

    @Transactional
    public Connection phoneConnection(UUID cameraId, String sessionToken) {
        requireConfigured();
        NotebookCamera camera = cameras.findLockedById(cameraId).orElseThrow(NotebookCameraService::notFound);
        if (camera.getClaimedAt() == null || !matches(sessionToken, camera.getSessionTokenHash())) throw notFound();
        User owner = requireCurrent(camera);
        return issue(camera, phoneIdentityFor(cameraId), owner.getFullName(), PHONE_GRANT);
    }

    /** Called in the same transaction as ending or cancelling the full classroom. */
    @Transactional
    public void revokeClass(UUID classId) {
        cameras.findAllByClassIdAndRevokedAtIsNull(classId).forEach(this::revokeAndClose);
    }

    /** Called when the teacher removes a pupil from the classroom. */
    @Transactional
    public void revokeClassOwner(UUID classId, UUID ownerId) {
        cameras.findAllByClassIdAndRevokedAtIsNull(classId).stream()
                .filter(camera -> camera.getOwnerId().equals(ownerId)).forEach(this::revokeAndClose);
    }

    /** Tokens expiring does not stop an already connected stream, so close it too. */
    @Scheduled(fixedDelayString = "${app.notebook-cameras.cleanup-delay-ms:60000}")
    @Transactional
    public void closeExpiredAndUnauthorized() {
        cameras.findAllByRevokedAtNotNullAndRoomClosedAtIsNull().forEach(this::closeRoom);
        cameras.findAllByRevokedAtIsNull().stream()
                .filter(camera -> !camera.isActive(clock.instant()) || !stillAuthorized(camera))
                .forEach(this::revokeAndClose);
    }

    private Connection issue(NotebookCamera camera, String identity, String name, MediaGrant grant) {
        Duration remaining = Duration.between(clock.instant(), camera.getSessionExpiresAt());
        if (remaining.isNegative() || remaining.isZero()) throw notFound();
        Duration ttl = remaining.compareTo(MEDIA_TOKEN_TTL) < 0 ? remaining : MEDIA_TOKEN_TTL;
        try {
            media.ensureRoom(camera.getRoomName());
            return Connection.of(media.createConnection(camera.getRoomName(), identity, name, grant, ttl), camera.getId());
        } catch (MediaProviderException failure) {
            // Never return upstream messages, room URLs or credentials as diagnostics.
            throw new ConflictException("The notebook camera could not connect; please try again");
        }
    }

    private void requireViewer(AuthenticatedUser caller, NotebookCamera camera) {
        LessonHistoryEntry lesson = requireLesson(caller, camera.getEventId());
        if (!lesson.getTeacher().getId().equals(camera.getTeacherId())
                || (caller.role() != Role.TEACHER && !caller.id().equals(camera.getOwnerId()))) throw notFound();
        requireClass(camera.getClassId(), caller, lesson);
    }

    private LessonHistoryEntry requireLesson(AuthenticatedUser caller, String eventId) {
        if (eventId == null || eventId.isBlank() || eventId.length() > 255) throw notFound();
        User account = requireActive(caller.id());
        if (account.getRole() != caller.role()) throw notFound();
        UUID teacherId = account.getRole() == Role.TEACHER ? account.getId()
                : account.getRole() == Role.STUDENT && account.getTeacher() != null
                ? account.getTeacher().getId() : null;
        if (teacherId == null || !pilot.isEnabledForTeacher(teacherId)) throw notFound();
        User teacher = requireActive(teacherId);
        if (teacher.getRole() != Role.TEACHER) throw notFound();
        LessonHistoryEntry lesson = lessons.findByTeacherIdAndEventId(teacherId, eventId)
                .orElseThrow(NotebookCameraService::notFound);
        requireAssigned(account, lesson);
        return lesson;
    }

    private User requireCurrent(NotebookCamera camera) {
        if (!camera.isActive(clock.instant())) throw notFound();
        User owner = requireActive(camera.getOwnerId());
        LessonHistoryEntry lesson = requireLesson(principal(owner), camera.getEventId());
        if (!lesson.getTeacher().getId().equals(camera.getTeacherId())) throw notFound();
        requireClass(camera.getClassId(), principal(owner), lesson);
        return owner;
    }

    private boolean stillAuthorized(NotebookCamera camera) {
        try {
            requireCurrent(camera);
            return true;
        } catch (ResourceNotFoundException | ConflictException denied) {
            return false;
        }
    }

    private void requireAssigned(User owner, LessonHistoryEntry lesson) {
        UUID teacherId = lesson.getTeacher().getId();
        if (owner.getRole() == Role.TEACHER && owner.getId().equals(teacherId)) return;
        if (owner.getRole() != Role.STUDENT || owner.getTeacher() == null
                || !owner.getTeacher().getId().equals(teacherId)) throw notFound();
        boolean assigned = owner.getId().equals(lesson.getStudentId())
                || (lesson.getGroupId() != null
                && groups.existsByGroupIdAndStudentId(lesson.getGroupId(), owner.getId()));
        if (!assigned) throw notFound();
    }

    private void requireClass(UUID classId, AuthenticatedUser owner, LessonHistoryEntry lesson) {
        if (classId == null) return;
        OnlineClass onlineClass = classAccess.requireAdmitted(owner, classId);
        if (!onlineClass.isConnectable() || !onlineClass.getEventId().equals(lesson.getEventId())
                || !onlineClass.getTeacher().getId().equals(lesson.getTeacher().getId())) throw notFound();
    }

    private User requireActive(UUID id) {
        return users.findById(id).filter(user -> !user.isArchived() && user.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(NotebookCameraService::notFound);
    }

    private void requireConfigured() {
        if (!media.isConfigured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Notebook cameras are not available on this server");
    }

    private void revokeAndClose(NotebookCamera camera) {
        camera.revoke(clock.instant());
        closeRoom(camera);
    }

    private void closeRoom(NotebookCamera camera) {
        // Keep an outage pending and retry after configuration/transport recovers.
        if (!media.isConfigured() || camera.getRoomClosedAt() != null) return;
        try {
            // Remove live identities first so held participant tokens are also revoked
            // by providers which implement token revocation on removal.
            for (String identity : media.listParticipantIdentities(camera.getRoomName())) {
                try {
                    media.removeParticipant(camera.getRoomName(), identity);
                } catch (MediaProviderException failure) {
                    log.warn("Notebook camera participant disconnect failed: cameraId={}", camera.getId());
                }
            }
        } catch (MediaProviderException failure) {
            log.warn("Notebook camera participant listing failed: cameraId={}", camera.getId());
        }
        try {
            media.closeRoom(camera.getRoomName());
            camera.roomClosed(clock.instant());
        } catch (MediaProviderException failure) {
            log.warn("Notebook camera revoked locally; room close failed: cameraId={}", camera.getId());
        }
    }

    private CameraView view(NotebookCamera camera, User owner) {
        String status = camera.getRevokedAt() != null ? "REVOKED"
                : !camera.isActive(clock.instant()) ? "EXPIRED"
                : camera.getClaimedAt() == null ? "PAIRING" : "CONNECTED";
        return new CameraView(camera.getId(), camera.getEventId(), camera.getOwnerId(), owner.getFullName(),
                camera.getClassId(), status, camera.getPairingExpiresAt(), camera.getSessionExpiresAt());
    }

    private static AuthenticatedUser principal(User user) {
        return new AuthenticatedUser(user.getId(), null, user.getRole());
    }

    static String phoneIdentityFor(UUID cameraId) { return "notebook-phone:" + cameraId; }

    private static String secret() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static boolean matches(String token, String storedHash) {
        if (token == null || token.length() != 43 || storedHash == null) return false;
        return MessageDigest.isEqual(hash(token).getBytes(StandardCharsets.US_ASCII),
                storedHash.getBytes(StandardCharsets.US_ASCII));
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Camera link is invalid, expired or no longer available");
    }
}
