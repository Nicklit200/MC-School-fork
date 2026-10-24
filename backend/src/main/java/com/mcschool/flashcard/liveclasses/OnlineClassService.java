package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.GoogleCalendarLessonService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassConnectionResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassRecordingProvider;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaGrant;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.notebookcamera.NotebookCameraService;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lifecycle and connection handling for online classes.
 *
 * <p>Every lifecycle operation is idempotent and validates the transition inside
 * a transaction, so a retried request (a double-clicked button, a reconnecting
 * client) cannot create a second class or regress state.
 */
@Service
public class OnlineClassService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassService.class);

    private final OnlineClassRepository classRepository;
    private final OnlineClassParticipantRepository participantRepository;
    private final OnlineClassAccessService accessService;
    private final GoogleCalendarLessonService lessonService;
    private final StudentGroupRepository groupRepository;
    private final LiveClassMediaProvider mediaProvider;
    private final ClassRecordingProvider recordingProvider;
    private final ClassTranscriptionProvider transcriptionProvider;
    private final OnlineClassProperties properties;
    private final OnlineClassMetrics metrics;
    private final Clock clock;
    private final NotebookCameraService notebookCameras;

    public OnlineClassService(OnlineClassRepository classRepository,
                              OnlineClassParticipantRepository participantRepository,
                              OnlineClassAccessService accessService,
                              GoogleCalendarLessonService lessonService,
                              StudentGroupRepository groupRepository,
                              LiveClassMediaProvider mediaProvider,
                              ClassRecordingProvider recordingProvider,
                              ClassTranscriptionProvider transcriptionProvider,
                              OnlineClassProperties properties,
                              OnlineClassMetrics metrics,
                              Clock clock,
                              NotebookCameraService notebookCameras) {
        this.classRepository = classRepository;
        this.participantRepository = participantRepository;
        this.accessService = accessService;
        this.lessonService = lessonService;
        this.groupRepository = groupRepository;
        this.mediaProvider = mediaProvider;
        this.recordingProvider = recordingProvider;
        this.transcriptionProvider = transcriptionProvider;
        this.properties = properties;
        this.metrics = metrics;
        this.clock = clock;
        this.notebookCameras = notebookCameras;
    }

    // --- Materialization -----------------------------------------------------

    /**
     * Creates, or returns, the durable class for one calendar occurrence.
     *
     * <p>Ownership is proved by the lesson appearing in the calling teacher's own
     * calendar listing — a teacher cannot materialize someone else's lesson by
     * guessing an event id.
     */
    @Transactional
    public OnlineClassResponse materializeFromCalendar(AuthenticatedUser caller, String eventId) {
        requireEnabled();
        GroupLessonResponse lesson = lessonService.listGroupLessons(caller).stream()
                .filter(candidate -> candidate.eventId().equals(eventId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));

        // An ended calendar occurrence cannot be started again. For teacher-led
        // testing, keep its transcript/attendance untouched and materialize a
        // separate session with a fresh LiveKit room.
        OnlineClass scheduled = classRepository
                .findByTeacherIdAndEventIdAndScheduledStartAt(caller.id(), eventId, lesson.startsAt())
                .orElse(null);
        if (scheduled == null) {
            return toResponse(create(caller, lesson), caller);
        }
        if (!scheduled.isTerminal()) {
            if (hasCurrentTarget(scheduled, lesson)
                    && (!scheduled.isConnectable() || canStudentJoin(scheduled))) {
                return toResponse(scheduled, caller);
            }
            retireSession(caller, scheduled);
        }
        // Reuse an already-created retry if the teacher clicks Start again.
        List<OnlineClass> occurrences = classRepository
                .findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(caller.id(), eventId);
        for (OnlineClass occurrence : occurrences) {
            if (!occurrence.isTerminal() && (!hasCurrentTarget(occurrence, lesson)
                    || (occurrence.isConnectable() && !canStudentJoin(occurrence)))) {
                retireSession(caller, occurrence);
            }
        }
        OnlineClass retry = occurrences.stream()
                .filter(item -> !item.isTerminal() && hasCurrentTarget(item, lesson))
                .findFirst()
                .orElse(null);
        if (retry != null) {
            return toResponse(retry, caller);
        }
        return toResponse(createRetry(caller, lesson), caller);
    }

    private void retireSession(AuthenticatedUser caller, OnlineClass onlineClass) {
        if (onlineClass.isConnectable()) {
            end(caller, onlineClass.getId());
        } else {
            cancel(caller, onlineClass.getId());
        }
    }

    private boolean hasCurrentTarget(OnlineClass onlineClass, GroupLessonResponse lesson) {
        return onlineClass.getBindingKey().equals(lesson.bindingKey())
                && java.util.Objects.equals(onlineClass.getStudent() == null ? null : onlineClass.getStudent().getId(), lesson.studentId())
                && java.util.Objects.equals(onlineClass.getGroup() == null ? null : onlineClass.getGroup().getId(), lesson.groupId());
    }

    private OnlineClass create(AuthenticatedUser caller, GroupLessonResponse lesson) {
        User teacher = accessService.requireActiveUser(caller.id());
        if (lesson.startsAt() == null || lesson.endsAt() == null) {
            throw new ConflictException("This lesson has no scheduled time");
        }

        Instant scheduledEnd = DateOnlyLessonSchedule.onlineClassEnd(lesson);
        OnlineClass created;
        if (lesson.groupId() != null) {
            StudentGroup group = groupRepository.findByIdAndTeacherId(lesson.groupId(), caller.id())
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
            created = OnlineClass.forGroup(teacher, lesson.eventId(), lesson.bindingKey(),
                    lesson.title(), lesson.startsAt(), scheduledEnd, group);
        } else if (lesson.studentId() != null) {
            User student = accessService.requireActiveUser(lesson.studentId());
            created = OnlineClass.forStudent(teacher, lesson.eventId(), lesson.bindingKey(),
                    lesson.title(), lesson.startsAt(), scheduledEnd, student);
        } else {
            throw new ConflictException("This lesson is not linked to a student or group yet");
        }

        OnlineClass saved = classRepository.save(created);
        log.info("Online class materialized: classId={} status={}", saved.getId(), saved.getStatus());
        return saved;
    }

    private OnlineClass createRetry(AuthenticatedUser caller, GroupLessonResponse lesson) {
        User teacher = accessService.requireActiveUser(caller.id());
        Instant retryStart = now();
        Instant retryEnd = retryStart.plus(java.time.Duration.between(lesson.startsAt(), lesson.endsAt()));
        OnlineClass created;
        if (lesson.groupId() != null) {
            StudentGroup group = groupRepository.findByIdAndTeacherId(lesson.groupId(), caller.id())
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
            created = OnlineClass.forGroup(teacher, lesson.eventId(), lesson.bindingKey(),
                    lesson.title(), retryStart, retryEnd, group);
        } else if (lesson.studentId() != null) {
            User student = accessService.requireActiveUser(lesson.studentId());
            created = OnlineClass.forStudent(teacher, lesson.eventId(), lesson.bindingKey(),
                    lesson.title(), retryStart, retryEnd, student);
        } else {
            throw new ConflictException("This lesson is not linked to a student or group yet");
        }
        return classRepository.save(created);
    }

    /**
     * Creates a class directly from a student or group, bypassing Google
     * Calendar.
     *
     * <p>Exists so the feature can be exercised on an environment where the
     * Calendar integration is not connected — otherwise
     * {@link #materializeFromCalendar} has nothing to work from and the feature
     * cannot be demonstrated at all.
     *
     * <p>Guarded by {@code app.online-classes.allow-test-classes}, which is
     * <strong>false by default</strong> and must stay false in production. Even
     * when enabled it grants nothing extra: the caller must be a teacher, and
     * the student or group must be one of their own.
     */
    @Transactional
    public OnlineClassResponse createTestClass(AuthenticatedUser caller, UUID studentId,
                                               UUID groupId, String title) {
        requireEnabled();
        if (!properties.allowTestClasses()) {
            throw new ResourceNotFoundException("Not found");
        }
        User teacher = accessService.requireActiveUser(caller.id());
        if (caller.role() != Role.TEACHER) {
            throw new ResourceNotFoundException("Not found");
        }

        Instant start = now().minus(java.time.Duration.ofMinutes(5));
        Instant end = start.plus(java.time.Duration.ofHours(1));
        // A distinct event id per call keeps the unique-occurrence index happy
        // when a tester creates several.
        String eventId = "test-" + UUID.randomUUID();
        String safeTitle = (title == null || title.isBlank()) ? "Test class" : title.strip();

        OnlineClass created;
        if (groupId != null) {
            StudentGroup group = groupRepository.findByIdAndTeacherId(groupId, caller.id())
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
            created = OnlineClass.forGroup(teacher, eventId, eventId, safeTitle, start, end, group);
        } else if (studentId != null) {
            User student = accessService.requireActiveUser(studentId);
            // Only the teacher's own student may be bound.
            if (student.getTeacher() == null
                    || !student.getTeacher().getId().equals(caller.id())) {
                throw new ResourceNotFoundException("Student not found");
            }
            created = OnlineClass.forStudent(teacher, eventId, eventId, safeTitle, start, end, student);
        } else {
            throw new ConflictException("A student or group is required");
        }

        OnlineClass saved = classRepository.save(created);
        log.info("Test online class created: classId={}", saved.getId());
        return toResponse(saved, caller);
    }

    // --- Discovery -----------------------------------------------------------

    @Transactional(readOnly = true)
    public List<OnlineClassResponse> listUpcoming(AuthenticatedUser caller) {
        requireEnabled();
        List<OnlineClassStatus> active = List.of(OnlineClassStatus.SCHEDULED,
                OnlineClassStatus.LOBBY_OPEN, OnlineClassStatus.LIVE);
        Instant from = now().minus(properties.joinWindowAfterEnd());

        List<OnlineClass> classes = caller.role() == Role.TEACHER
                ? classRepository.findAllByTeacherIdAndStatusInOrderByScheduledStartAtAsc(caller.id(), active)
                : classRepository.findVisibleToStudent(caller.id(), from, now(), active);

        return classes.stream()
                .filter(item -> caller.role() == Role.TEACHER || !item.isConnectable() || canStudentJoin(item))
                .map(item -> toResponse(item, caller)).toList();
    }

    /**
     * Finds the class already materialized for a calendar event, without
     * creating one.
     *
     * <p>The lesson detail page uses this to decide whether to show post-class
     * artifacts; opening a lesson must never bring a class into existence as a
     * side effect.
     */
    @Transactional(readOnly = true)
    public List<OnlineClassResponse> findByEvent(AuthenticatedUser caller, String eventId) {
        requireEnabled();
        return classRepository.findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(
                        caller.id(), eventId)
                .stream()
                .map(item -> toResponse(item, caller))
                .toList();
    }

    @Transactional(readOnly = true)
    public OnlineClassResponse get(AuthenticatedUser caller, UUID classId) {
        requireEnabled();
        return toResponse(accessService.requireViewer(caller, classId), caller);
    }

    // --- Lifecycle -----------------------------------------------------------

    @Transactional
    public OnlineClassResponse openLobby(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        requireCurrentSession(onlineClass);
        if (!mediaProvider.isConfigured()) {
            throw new ConflictException("Online classes are not available on this server");
        }
        if (!onlineClass.isConnectable() && !onlineClass.isTerminal()) {
            extendJoinWindowForOpening(onlineClass);
        }
        onlineClass.openLobby();
        ensureHostParticipant(onlineClass);
        return toResponse(onlineClass, caller);
    }

    @Transactional
    public OnlineClassResponse start(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        requireCurrentSession(onlineClass);
        // Fail with a precise, teacher-facing message rather than a 500 when the
        // provider is not configured. Checked before any state change so a
        // misconfigured server does not leave a half-started class behind.
        if (!mediaProvider.isConfigured()) {
            throw new ConflictException("Online classes are not available on this server");
        }

        if (onlineClass.getStatus() == OnlineClassStatus.SCHEDULED) {
            extendJoinWindowForOpening(onlineClass);
        }
        onlineClass.start(now());
        ensureHostParticipant(onlineClass);
        try {
            // The room is created up front so students are never told to join a
            // room that does not exist yet.
            mediaProvider.ensureRoom(onlineClass.getRoomName());
        } catch (MediaProviderException e) {
            metrics.providerFailure("ensureRoom");
            throw new ConflictException("The class could not be opened; please try again");
        }
        metrics.classTransition(OnlineClassStatus.LIVE);
        log.info("Online class started: classId={}", onlineClass.getId());
        return toResponse(onlineClass, caller);
    }

    @Transactional
    public OnlineClassResponse end(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        Instant endedAt = now();
        onlineClass.end(endedAt);
        notebookCameras.revokeClass(classId);
        closeConnectionsFor(onlineClass, endedAt);
        // A provider outage must not block ending the class in our own records.
        try {
            mediaProvider.closeRoom(onlineClass.getRoomName());
        } catch (MediaProviderException e) {
            metrics.providerFailure("closeRoom");
            log.warn("Online class ended locally but the room could not be closed: classId={}",
                    onlineClass.getId());
        }
        metrics.classTransition(OnlineClassStatus.ENDED);
        log.info("Online class ended: classId={}", onlineClass.getId());
        return toResponse(onlineClass, caller);
    }

    @Transactional
    public OnlineClassResponse cancel(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        onlineClass.cancel();
        notebookCameras.revokeClass(classId);
        return toResponse(onlineClass, caller);
    }

    /** Credits attendance for anyone still marked connected when the class ends. */
    private void closeConnectionsFor(OnlineClass onlineClass, Instant endedAt) {
        participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(onlineClass.getId())
                .forEach(participant -> {
                    if (participant.isConnected()) {
                        participant.markLeft(endedAt);
                    }
                });
    }

    /**
     * Owner-only, non-secret probe to distinguish media-provider API failure
     * from a browser/WebRTC transport failure. This does not issue an access
     * token and never returns the LiveKit URL or credentials.
     */
    /** Only a host can run this probe. It returns fixed status names, not
     * LiveKit response bodies, tokens, URLs or credential fragments.
     * AUTH_REJECTED covers 401/403 returned by the LiveKit server API.
     */
    public record MediaApiDiagnosis(boolean reachable, String status) {}

    @Transactional(readOnly = true)
    public MediaApiDiagnosis diagnoseMediaApi(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        if (!mediaProvider.isConfigured()) {
            return new MediaApiDiagnosis(false, "NOT_CONFIGURED");
        }
        try {
            mediaProvider.ensureRoom(onlineClass.getRoomName());
            return new MediaApiDiagnosis(true, "OK");
        } catch (MediaProviderException e) {
            metrics.providerFailure("diagnostics");
            // Never pass the raw upstream error to callers. The public response
            // identifies only whether an operator should check credentials.
            String providerMessage = e.getMessage();
            String status = "LiveKit request failed with HTTP 401".equals(providerMessage)
                    || "LiveKit request failed with HTTP 403".equals(providerMessage)
                    ? "AUTH_REJECTED" : "UNREACHABLE";
            log.warn("LiveKit API diagnostic status={} for classId={}", status, classId);
            return new MediaApiDiagnosis(false, status);
        }
    }

    @Transactional(readOnly = true)
    public boolean checkMediaApi(AuthenticatedUser caller, UUID classId) {
        return diagnoseMediaApi(caller, classId).reachable();
    }

    // --- Connection ----------------------------------------------------------

    /**
     * Issues a short-lived, room-scoped token after authorization, admission and
     * time-window checks all pass.
     */
    @Transactional
    public OnlineClassConnectionResponse connect(AuthenticatedUser caller, UUID classId, String deviceId) {
        requireEnabled();
        if (!mediaProvider.isConfigured()) {
            throw new ConflictException("Online classes are not available on this server");
        }

        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        boolean host = accessService.isHost(caller, onlineClass);

        if (!onlineClass.isConnectable()) {
            throw new ConflictException("This class is not open");
        }
        // A teacher may deliberately open a late lesson. Its explicit opening
        // has a bounded expiry; an abandoned historical room still expires.
        if (!host && !canStudentJoin(onlineClass)) {
            throw new ConflictException("This class is not open for joining anymore");
        }

        User user = accessService.requireActiveUser(caller.id());
        OnlineClassParticipant participant = participantRepository
                .findByOnlineClassIdAndUserId(classId, caller.id())
                .orElseGet(() -> participantRepository.save(host
                        ? OnlineClassParticipant.host(onlineClass, user)
                        : OnlineClassParticipant.student(onlineClass, user)));

        // A removed participant must never receive a new token.
        if (participant.getAdmissionState() == AdmissionState.REMOVED) {
            throw new ConflictException("You have been removed from this class");
        }
        if (participant.getAdmissionState() == AdmissionState.REJECTED) {
            throw new ConflictException("The teacher declined your request to join");
        }
        if (!participant.isAdmitted()) {
            throw new ConflictException("Waiting for the teacher to admit you");
        }

        MediaGrant grant = host
                ? MediaGrant.host()
                : MediaGrant.student(onlineClass.isStudentScreenShareEnabled()
                        && participant.isScreenShareEnabled());

        String identity = ParticipantIdentity.of(caller.id(), deviceId);
        ParticipantConnection connection = mediaProvider.createConnection(
                onlineClass.getRoomName(), identity, user.getFullName(), grant, properties.tokenTtl());

        participant.markJoined(now());
        metrics.participantJoined(host);

        // Never log the token or the signed URL.
        log.info("Online class connection issued: classId={} host={}", classId, host);

        return new OnlineClassConnectionResponse(
                connection.serverUrl(),
                connection.token(),
                connection.identity(),
                connection.roomName(),
                connection.expiresAt(),
                host,
                onlineClass.getRecordingState() == ClassFeatureState.ACTIVE,
                onlineClass.getTranscriptionState() == ClassFeatureState.ACTIVE);
    }

    @Transactional
    public void leave(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        participantRepository.findByOnlineClassIdAndUserId(onlineClass.getId(), caller.id())
                .ifPresent(participant -> {
                    participant.markLeft(now());
                    metrics.participantLeft();
                });
    }

    // --- Helpers -------------------------------------------------------------

    /**
     * Students may join from a configurable window before the scheduled start
     * until a limited period after the scheduled end. This is what stops tokens
     * being minted for arbitrary historical lessons.
     */
    boolean isWithinJoinWindow(OnlineClass onlineClass) {
        Instant now = now();
        Instant opensAt = onlineClass.getScheduledStartAt().minus(properties.joinWindowBeforeStart());
        Instant closesAt = onlineClass.getScheduledEndAt().plus(properties.joinWindowAfterEnd());
        return !now.isBefore(opensAt) && !now.isAfter(closesAt);
    }

    private boolean canStudentJoin(OnlineClass onlineClass) {
        Instant closesAt = onlineClass.getStudentJoinUntil() != null
                ? onlineClass.getStudentJoinUntil()
                : onlineClass.getScheduledEndAt().plus(properties.joinWindowAfterEnd());
        return onlineClass.isConnectable() && !now().isAfter(closesAt);
    }

    private void extendJoinWindowForOpening(OnlineClass onlineClass) {
        java.time.Duration duration = java.time.Duration.between(
                onlineClass.getScheduledStartAt(), onlineClass.getScheduledEndAt());
        if (duration.compareTo(java.time.Duration.ofHours(24)) > 0) {
            duration = java.time.Duration.ofHours(24);
        }
        Instant fromOpening = now().plus(duration).plus(properties.joinWindowAfterEnd());
        Instant fromSchedule = onlineClass.getScheduledEndAt().plus(properties.joinWindowAfterEnd());
        onlineClass.allowStudentJoiningUntil(fromOpening.isAfter(fromSchedule) ? fromOpening : fromSchedule);
    }

    private void requireCurrentSession(OnlineClass onlineClass) {
        if (onlineClass.isConnectable() && !canStudentJoin(onlineClass)) {
            throw new ConflictException("This session has expired; start a new session from the lesson page");
        }
    }

    private OnlineClass requireHostForMutation(AuthenticatedUser caller, UUID classId) {
        requireEnabled();
        return accessService.requireHost(caller, classId);
    }

    private void ensureHostParticipant(OnlineClass onlineClass) {
        participantRepository.findByOnlineClassIdAndUserId(
                        onlineClass.getId(), onlineClass.getTeacher().getId())
                .orElseGet(() -> participantRepository.save(
                        OnlineClassParticipant.host(onlineClass, onlineClass.getTeacher())));
    }

    private void requireEnabled() {
        if (!properties.enabled()) {
            throw new ResourceNotFoundException("Online classes are not enabled");
        }
    }

    private OnlineClassResponse toResponse(OnlineClass onlineClass, AuthenticatedUser caller) {
        return OnlineClassResponse.from(onlineClass,
                accessService.isHost(caller, onlineClass),
                !onlineClass.isTerminal() && (onlineClass.isConnectable()
                        ? canStudentJoin(onlineClass) : isWithinJoinWindow(onlineClass)),
                recordingProvider.isConfigured(),
                transcriptionProvider.isConfigured());
    }

    private Instant now() {
        return clock.instant();
    }
}
