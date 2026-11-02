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
    static final java.time.Duration EMPTY_MEDIA_GRACE = java.time.Duration.ofSeconds(60);

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
    private final TeacherPresenceService teacherPresence;

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
                              NotebookCameraService notebookCameras,
                              TeacherPresenceService teacherPresence) {
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
        this.teacherPresence = teacherPresence;
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
        if (caller.role() != Role.TEACHER) throw new ResourceNotFoundException("Lesson not found");
        GroupLessonResponse lesson = lessonService.listGroupLessons(caller).stream()
                .filter(candidate -> candidate.eventId().equals(eventId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));

        if (lesson.startsAt() == null || lesson.endsAt() == null) {
            throw new ConflictException("This lesson has no scheduled time");
        }
        // Google supplies a distinct event ID for every recurring occurrence;
        // recurringEventId is only its binding key. A moved occurrence retains
        // its event ID, durable room, artifacts and explicit terminal decision.
        OnlineClass latest = classRepository
                .findFirstByTeacherIdAndEventIdOrderByCreatedAtDesc(caller.id(), eventId)
                .orElse(null);
        if (latest == null) return toResponse(create(caller, lesson), caller);
        OnlineClass current;
        while (true) {
            current = accessService.requireHostForUpdate(caller, latest.getId());
            latest = classRepository.findFirstByTeacherIdAndEventIdOrderByCreatedAtDesc(caller.id(), eventId)
                    .orElse(current);
            if (latest.getId().equals(current.getId())) break;
        }
        if (current.isTerminal()) return toResponse(current, caller);
        if (hasCurrentTarget(current, lesson)) {
            Instant scheduledStart = availableOccurrenceStart(caller.id(), lesson, current.getId());
            Instant scheduledEnd = DateOnlyLessonSchedule.onlineClassEnd(lesson);
            if (!scheduledEnd.isAfter(scheduledStart)) scheduledEnd = scheduledStart.plusNanos(1000);
            if (!current.getScheduledStartAt().equals(scheduledStart)
                    || !current.getScheduledEndAt().equals(scheduledEnd)) {
                current.reschedule(scheduledStart, scheduledEnd);
            }
            return toResponse(current, caller);
        }
        // Changing the pupil is a new authorized binding, rather than a
        // reconnect. Retire its old room without widening student date access.
        retireSession(caller, current);
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
        Instant retryStart = availableOccurrenceStart(caller.id(), lesson, null);
        Instant retryEnd = DateOnlyLessonSchedule.onlineClassEnd(lesson);
        if (!retryEnd.isAfter(retryStart)) retryEnd = retryStart.plusNanos(1000);
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

    private Instant availableOccurrenceStart(UUID teacherId, GroupLessonResponse lesson, UUID excludeId) {
        // The occurrence index includes scheduled_start_at. Select a distinct
        // microsecond for a corrected binding while retaining the calendar day,
        // so early/late teacher entry never moves a student's admission window.
        java.util.Set<Instant> occupiedStarts = classRepository
                .findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(teacherId, lesson.eventId())
                .stream().filter(item -> !item.getId().equals(excludeId))
                .map(OnlineClass::getScheduledStartAt).collect(java.util.stream.Collectors.toSet());
        Instant base = lesson.startsAt().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        Instant retryStart = base;
        long offset = 1;
        while (occupiedStarts.contains(retryStart)) {
            retryStart = base.plus(offset, java.time.temporal.ChronoUnit.MICROS);
            if (!LessonEntryPolicy.lessonDate(retryStart).equals(LessonEntryPolicy.lessonDate(base))) {
                retryStart = base.minus(offset, java.time.temporal.ChronoUnit.MICROS);
            }
            offset++;
        }
        return retryStart;
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
        Instant from = LessonEntryPolicy.dayStart(now());

        List<OnlineClass> classes = caller.role() == Role.TEACHER
                ? classRepository.findAllByTeacherIdAndStatusInOrderByScheduledStartAtAsc(caller.id(), active)
                : classRepository.findVisibleToStudent(caller.id(), from,
                        List.of(OnlineClassStatus.LOBBY_OPEN, OnlineClassStatus.LIVE),
                        List.of(OnlineClassStatus.SCHEDULED, OnlineClassStatus.LOBBY_OPEN, OnlineClassStatus.LIVE,
                                OnlineClassStatus.ENDED, OnlineClassStatus.CANCELLED));

        return classes.stream()
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
            initializeOpening(onlineClass);
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
            initializeOpening(onlineClass);
        }
        onlineClass.start(now());
        ensureHostParticipant(onlineClass);
        try {
            // Probe without provisioning media. LiveKit creates the physical
            // room when the teacher actually connects with their scoped token.
            if (hasHumanParticipants(mediaProvider.listParticipantIdentities(onlineClass.getRoomName()))) {
                onlineClass.observeOccupied();
            } else {
                onlineClass.observeEmpty(now());
            }
        } catch (MediaProviderException e) {
            metrics.providerFailure("presence");
            throw new ConflictException("The class could not be opened; please try again");
        }
        // Opening the room precedes prejoin/media connection. The teacher's
        // connected browser requests transcription once they actually enter;
        // that endpoint verifies their presence with LiveKit before dispatch.
        metrics.classTransition(OnlineClassStatus.LIVE);
        log.info("Online class started: classId={}", onlineClass.getId());
        return toResponse(onlineClass, caller);
    }

    @Transactional
    public OnlineClassResponse end(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        finishSession(onlineClass, now());
        return toResponse(onlineClass, caller);
    }

    @Transactional
    public OnlineClassResponse cancel(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHostForUpdate(caller, classId);
        onlineClass.cancel();
        onlineClass.setMediaClosePending(true);
        closeProviderRoom(onlineClass);
        notebookCameras.revokeClass(classId);
        return toResponse(onlineClass, caller);
    }

    /**
     * Teacher-confirmed lesson removal is also an explicit instruction to
     * close its associated online room. Do not require the class feature flag:
     * retiring an existing room must still work if LiveKit was disabled after
     * the room was created. The scheduled lesson and all artifacts are retained
     * as tombstoned history by the caller.
     */
    @Transactional
    public void closeForLessonRemoval(AuthenticatedUser caller, UUID classId) {
        OnlineClass room = accessService.requireHostForUpdate(caller, classId);
        if (room.isTerminal()) return;
        if (room.isConnectable()) {
            finishSession(room, now());
        } else {
            // Never-connected rooms are cancelled, not recorded as attended.
            room.cancel();
            room.setMediaClosePending(true);
            notebookCameras.revokeClass(room.getId());
            closeProviderRoom(room);
        }
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

    @Transactional
    public MediaApiDiagnosis diagnoseMediaApi(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        requireCurrentSession(onlineClass);
        if (!mediaProvider.isConfigured()) {
            return new MediaApiDiagnosis(false, "NOT_CONFIGURED");
        }
        try {
            mediaProvider.listParticipantIdentities(onlineClass.getRoomName());
            return new MediaApiDiagnosis(true, "OK");
        } catch (MediaProviderException e) {
            metrics.providerFailure("diagnostics");
            // Never pass the raw upstream error to callers. The public response
            // identifies only whether an operator should check credentials.
            String providerMessage = e.getMessage();
            String status = providerMessage != null && (providerMessage.endsWith("HTTP 401")
                    || providerMessage.endsWith("HTTP 403"))
                    ? "AUTH_REJECTED" : "UNREACHABLE";
            log.warn("LiveKit API diagnostic status={} for classId={}", status, classId);
            return new MediaApiDiagnosis(false, status);
        }
    }

    @Transactional
    public boolean checkMediaApi(AuthenticatedUser caller, UUID classId) {
        requireHostForMutation(caller, classId);
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

        OnlineClass onlineClass = accessService.requireParticipantForUpdate(caller, classId);
        boolean host = accessService.isHost(caller, onlineClass);

        if (!onlineClass.isConnectable()) {
            throw new ConflictException("This class is not open");
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

        boolean teacherPresent = false;
        try {
            List<String> present = mediaProvider.listParticipantIdentities(onlineClass.getRoomName());
            teacherPresent = TeacherPresenceService.hasTeacher(onlineClass, present);
            if (!LessonEntryPolicy.canEnter(onlineClass, participant, now(), host, teacherPresent)) {
                // Another pupil or an agent cannot stand in for this room's owner.
                throw new ConflictException("Waiting for the teacher to enter the classroom");
            }
            if (host && present.isEmpty()) {
                // LiveKit can close an empty room itself. Clear the old run
                // before returning a fresh token so re-entry starts STT again.
                stopTranscriptionDispatch(onlineClass);
                onlineClass.setRecordingState(ClassFeatureState.INACTIVE);
                onlineClass.setMediaClosePending(false);
                onlineClass.observeEmpty(now());
            } else if (hasHumanParticipants(present)) {
                onlineClass.observeOccupied();
                onlineClass.setMediaClosePending(false);
            }
        } catch (MediaProviderException e) {
            throw new ConflictException("The classroom connection could not be verified; please try again");
        }

        MediaGrant grant = host
                ? MediaGrant.host()
                : MediaGrant.student(onlineClass.isStudentScreenShareEnabled()
                        && participant.isScreenShareEnabled());

        String identity = ParticipantIdentity.of(caller.id(), deviceId);
        java.time.Duration ttl = LessonEntryPolicy.tokenTtl(
                onlineClass, participant, now(), properties.tokenTtl(), host, teacherPresent);
        if (ttl.isNegative() || ttl.isZero()) throw new ConflictException("This class is not open for joining");
        ParticipantConnection connection = mediaProvider.createConnection(
                onlineClass.getRoomName(), identity, user.getFullName(), grant, ttl);

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
        OnlineClass onlineClass = accessService.requireParticipantForUpdate(caller, classId);
        participantRepository.findByOnlineClassIdAndUserId(onlineClass.getId(), caller.id())
                .ifPresent(participant -> {
                    participant.markLeft(now());
                    metrics.participantLeft();
                });
    }

    // --- Helpers -------------------------------------------------------------

    /** Half-open Berlin calendar day; never an extension from actual start. */
    boolean isWithinJoinWindow(OnlineClass onlineClass) {
        return LessonEntryPolicy.isLessonDay(onlineClass.getScheduledStartAt(), now());
    }

    private void initializeOpening(OnlineClass onlineClass) {
        onlineClass.allowStudentJoiningUntil(LessonEntryPolicy.dayEnd(onlineClass.getScheduledStartAt()));
    }

    private void requireCurrentSession(OnlineClass onlineClass) {
        if (onlineClass.isTerminal()) {
            throw new ConflictException("This lesson has ended; create a new lesson to start another class");
        }
        // Every caller has already passed requireHostForMutation. Calendar
        // admission limits apply to students, never to this owning teacher.
    }

    private OnlineClass requireHostForMutation(AuthenticatedUser caller, UUID classId) {
        requireEnabled();
        return accessService.requireHostForUpdate(caller, classId);
    }

    private void finishSession(OnlineClass onlineClass, Instant endedAt) {
        // Stop the actual agent dispatch, not the lesson UUID. No audio is
        // retained by this operation; final text segments are stored separately.
        String dispatchId = onlineClass.getTranscriptionDispatchId();
        if (dispatchId != null && !dispatchId.isBlank()) {
            try {
                transcriptionProvider.stopTranscription(onlineClass.getRoomName(), dispatchId);
                onlineClass.setTranscriptionDispatchId(null);
            } catch (MediaProviderException e) {
                log.warn("Soniox stop failed; room teardown will stop the agent: classId={}",
                        onlineClass.getId());
            }
        }
        onlineClass.end(endedAt);
        onlineClass.setMediaClosePending(true);
        notebookCameras.revokeClass(onlineClass.getId());
        closeConnectionsFor(onlineClass, endedAt);
        closeProviderRoom(onlineClass);
        metrics.classTransition(OnlineClassStatus.ENDED);
        log.info("Online class ended: classId={}", onlineClass.getId());
    }

    private void closeProviderRoom(OnlineClass onlineClass) {
        try {
            mediaProvider.closeRoom(onlineClass.getRoomName());
            onlineClass.setMediaClosePending(false);
        } catch (MediaProviderException e) {
            metrics.providerFailure("closeRoom");
            log.warn("Class ended locally; provider teardown will be retried: classId={}", onlineClass.getId());
        }
    }

    /** Release empty media, retaining the lesson and its re-entry permissions. */
    @Transactional
    public void reconcileIdleSession(UUID classId) {
        if (!properties.enabled()) return;
        OnlineClass room = classRepository.findForUpdate(classId).orElse(null);
        if (room == null) return;
        if (room.isTerminal()) {
            if (room.isMediaClosePending() && mediaProvider.isConfigured()) closeProviderRoom(room);
            return;
        }
        if (!room.isConnectable() || !mediaProvider.isConfigured()) return;

        try {
            List<String> present = mediaProvider.listParticipantIdentities(room.getRoomName());
            if (hasHumanParticipants(present)) {
                room.observeOccupied();
                room.setMediaClosePending(false);
                return;
            }
            room.observeEmpty(now());
            if (now().isBefore(room.getEmptySince().plus(EMPTY_MEDIA_GRACE))) return;

            // Recheck just before destructive media teardown. A transient API
            // failure is unknown presence, never proof that participants left.
            if (hasHumanParticipants(mediaProvider.listParticipantIdentities(room.getRoomName()))) {
                room.observeOccupied();
                room.setMediaClosePending(false);
                return;
            }
        } catch (MediaProviderException e) {
            metrics.providerFailure("presence");
            log.warn("Empty-room presence could not be verified: classId={}", room.getId());
            return;
        }
        suspendEmptyMedia(room);
    }

    private static boolean hasHumanParticipants(List<String> identities) {
        return identities.stream().anyMatch(identity -> ParticipantIdentity.userId(identity).isPresent());
    }

    private void stopTranscriptionDispatch(OnlineClass room) {
        String dispatchId = room.getTranscriptionDispatchId();
        if (dispatchId != null && !dispatchId.isBlank()) {
            transcriptionProvider.stopTranscription(room.getRoomName(), dispatchId);
        }
        room.setTranscriptionDispatchId(null);
        room.setTranscriptionState(ClassFeatureState.INACTIVE);
    }

    private void suspendEmptyMedia(OnlineClass room) {
        room.setMediaClosePending(true);
        try {
            stopTranscriptionDispatch(room);
        } catch (MediaProviderException e) {
            log.warn("Empty-room transcription stop will be retried: classId={}", room.getId());
        }
        try {
            mediaProvider.closeRoom(room.getRoomName());
            // A confirmed room deletion also terminates an unreachable agent.
            room.setTranscriptionDispatchId(null);
            room.setTranscriptionState(ClassFeatureState.INACTIVE);
            room.setRecordingState(ClassFeatureState.INACTIVE);
            room.setMediaClosePending(false);
            closeConnectionsFor(room, now());
        } catch (MediaProviderException e) {
            log.warn("Empty-room media cleanup will be retried: classId={}", room.getId());
        }
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
        OnlineClassParticipant participant = participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), caller.id()).orElse(null);
        Instant at = now();
        boolean host = accessService.isHost(caller, onlineClass);
        // Host listings can contain years of resumable rooms. Do not probe media
        // for every historical room; only student discovery needs this proof.
        boolean connectedHostHint = !host && onlineClass.isConnectable()
                && onlineClass.getEmptySince() != null && participantRepository
                    .findByOnlineClassIdAndUserId(onlineClass.getId(), onlineClass.getTeacher().getId())
                    .map(OnlineClassParticipant::isConnected).orElse(false);
        boolean teacherPresent = !host && teacherPresence.discovery(onlineClass, connectedHostHint);
        return OnlineClassResponse.from(onlineClass,
                host,
                LessonEntryPolicy.canEnter(onlineClass, participant, at, host, teacherPresent),
                recordingProvider.isConfigured(), transcriptionProvider.isConfigured(),
                LessonEntryPolicy.state(onlineClass, participant, at, host, teacherPresent),
                LessonEntryPolicy.hasJoined(onlineClass, participant), at, teacherPresent);
    }

    private Instant now() {
        return clock.instant();
    }
}
