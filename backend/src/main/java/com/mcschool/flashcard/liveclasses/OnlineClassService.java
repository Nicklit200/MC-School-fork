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
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaGrant;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    private final OnlineClassJoinRequestRepository joinRequestRepository;
    private final OnlineClassAccessService accessService;
    private final GoogleCalendarLessonService lessonService;
    private final StudentGroupRepository groupRepository;
    private final LiveClassMediaProvider mediaProvider;
    private final OnlineClassProperties properties;
    private final OnlineClassMetrics metrics;
    private final Clock clock;

    public OnlineClassService(OnlineClassRepository classRepository,
                              OnlineClassParticipantRepository participantRepository,
                              OnlineClassJoinRequestRepository joinRequestRepository,
                              OnlineClassAccessService accessService,
                              GoogleCalendarLessonService lessonService,
                              StudentGroupRepository groupRepository,
                              LiveClassMediaProvider mediaProvider,
                              OnlineClassProperties properties,
                              OnlineClassMetrics metrics,
                              Clock clock) {
        this.classRepository = classRepository;
        this.participantRepository = participantRepository;
        this.joinRequestRepository = joinRequestRepository;
        this.accessService = accessService;
        this.lessonService = lessonService;
        this.groupRepository = groupRepository;
        this.mediaProvider = mediaProvider;
        this.properties = properties;
        this.metrics = metrics;
        this.clock = clock;
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

        return classRepository
                .findByTeacherIdAndEventIdAndScheduledStartAt(caller.id(), eventId, lesson.startsAt())
                .map(existing -> toResponse(existing, caller))
                .orElseGet(() -> toResponse(create(caller, lesson), caller));
    }

    private OnlineClass create(AuthenticatedUser caller, GroupLessonResponse lesson) {
        User teacher = accessService.requireActiveUser(caller.id());
        if (lesson.startsAt() == null || lesson.endsAt() == null) {
            throw new ConflictException("This lesson has no scheduled time");
        }

        OnlineClass created;
        if (lesson.groupId() != null) {
            StudentGroup group = groupRepository.findByIdAndTeacherId(lesson.groupId(), caller.id())
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
            created = OnlineClass.forGroup(teacher, lesson.eventId(), lesson.bindingKey(),
                    lesson.title(), lesson.startsAt(), lesson.endsAt(), group);
        } else if (lesson.studentId() != null) {
            User student = accessService.requireActiveUser(lesson.studentId());
            created = OnlineClass.forStudent(teacher, lesson.eventId(), lesson.bindingKey(),
                    lesson.title(), lesson.startsAt(), lesson.endsAt(), student);
        } else {
            throw new ConflictException("This lesson is not linked to a student or group yet");
        }

        OnlineClass saved = classRepository.save(created);
        log.info("Online class materialized: classId={} status={}", saved.getId(), saved.getStatus());
        return saved;
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

        // Staging test classes are disposable. Keep exactly one active test
        // room per teacher so a teacher and student cannot accidentally open
        // two identically titled LIVE rooms and wait for each other forever.
        List<OnlineClassStatus> activeTestStatuses = List.of(
                OnlineClassStatus.SCHEDULED,
                OnlineClassStatus.LOBBY_OPEN,
                OnlineClassStatus.LIVE);
        Instant cleanupAt = now();
        classRepository
                .findAllByTeacherIdAndStatusInOrderByScheduledStartAtAsc(caller.id(), activeTestStatuses)
                .stream()
                .filter(item -> item.getEventId() != null && item.getEventId().startsWith("test-"))
                .forEach(item -> {
                    if (item.getStatus() == OnlineClassStatus.LIVE) {
                        item.end(cleanupAt);
                        closeConnectionsFor(item, cleanupAt);
                        try {
                            mediaProvider.closeRoom(item.getRoomName());
                        } catch (MediaProviderException e) {
                            metrics.providerFailure("closeRoom");
                            log.warn("Old staging test room could not be closed: classId={}", item.getId());
                        }
                    } else {
                        item.cancel();
                    }
                });

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
                : classRepository.findVisibleToStudent(caller.id(), from, active);

        log.info("Online classes upcoming: callerId={} role={} count={} classes={}",
                caller.id(),
                caller.role(),
                classes.size(),
                classes.stream()
                        .map(item -> item.getId()
                                + ":" + item.getStatus()
                                + ":student=" + (item.getStudent() == null ? "-" : item.getStudent().getId())
                                + ":group=" + (item.getGroup() == null ? "-" : item.getGroup().getId()))
                        .toList());

        List<OnlineClass> visible = canonicalizeTestClasses(classes);
        return visible.stream().map(item -> toResponse(item, caller)).toList();
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
        OnlineClass requested = accessService.requireViewer(caller, classId);
        OnlineClass canonical = canonicalTestClassFor(requested);
        return toResponse(canonical, caller);
    }

    // --- Lifecycle -----------------------------------------------------------

    @Transactional
    public OnlineClassResponse openLobby(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        if (!mediaProvider.isConfigured()) {
            throw new ConflictException("Online classes are not available on this server");
        }
        onlineClass.openLobby();
        ensureHostParticipant(onlineClass);
        return toResponse(onlineClass, caller);
    }

    @Transactional
    public OnlineClassResponse start(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = requireHostForMutation(caller, classId);
        // Fail with a precise, teacher-facing message rather than a 500 when the
        // provider is not configured. Checked before any state change so a
        // misconfigured server does not leave a half-started class behind.
        if (!mediaProvider.isConfigured()) {
            throw new ConflictException("Online classes are not available on this server");
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

    // --- Connection ----------------------------------------------------------

    /**
     * Issues a short-lived, room-scoped token after authorization, admission and
     * time-window checks all pass.
     */
    @Transactional(noRollbackFor = ConflictException.class)
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
        if (!host && !isWithinJoinWindow(onlineClass)) {
            throw new ConflictException("This class is not open for joining yet");
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
        if (!participant.isAdmitted()) {
            // Be resilient to an older/stale frontend bundle: asking for a
            // connection while the waiting room is enabled must also register
            // the student in the teacher's waiting room. This remains
            // idempotent because the DB allows only one pending request.
            joinRequestRepository
                    .findByOnlineClassIdAndUserIdAndState(classId, caller.id(), JoinRequestState.PENDING)
                    .orElseGet(() -> joinRequestRepository.save(
                            OnlineClassJoinRequest.knock(onlineClass, user, now())));
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

    private List<OnlineClass> canonicalizeTestClasses(List<OnlineClass> classes) {
        if (!properties.allowTestClasses()) {
            return classes;
        }

        Map<String, OnlineClass> latestTests = new LinkedHashMap<>();
        List<OnlineClass> normal = new java.util.ArrayList<>();

        for (OnlineClass onlineClass : classes) {
            if (!isTestClass(onlineClass)) {
                normal.add(onlineClass);
                continue;
            }

            String audience = audienceKey(onlineClass);
            OnlineClass previous = latestTests.get(audience);
            if (previous == null || isNewerTestClass(onlineClass, previous)) {
                latestTests.put(audience, onlineClass);
            }
        }

        normal.addAll(latestTests.values());
        normal.sort(Comparator.comparing(OnlineClass::getScheduledStartAt));
        return normal;
    }

    private OnlineClass canonicalTestClassFor(OnlineClass requested) {
        if (!properties.allowTestClasses() || !isTestClass(requested) || requested.isTerminal()) {
            return requested;
        }

        List<OnlineClassStatus> active = List.of(
                OnlineClassStatus.SCHEDULED,
                OnlineClassStatus.LOBBY_OPEN,
                OnlineClassStatus.LIVE);

        return classRepository
                .findAllByTeacherIdAndStatusInOrderByScheduledStartAtAsc(
                        requested.getTeacher().getId(), active)
                .stream()
                .filter(this::isTestClass)
                .filter(candidate -> audienceKey(candidate).equals(audienceKey(requested)))
                .max((left, right) -> isNewerTestClass(left, right) ? 1 : -1)
                .orElse(requested);
    }

    private boolean isTestClass(OnlineClass onlineClass) {
        return onlineClass.getEventId() != null && onlineClass.getEventId().startsWith("test-");
    }

    private String audienceKey(OnlineClass onlineClass) {
        if (onlineClass.getStudent() != null) {
            return "student:" + onlineClass.getStudent().getId();
        }
        return "group:" + onlineClass.getGroup().getId();
    }

    private boolean isNewerTestClass(OnlineClass left, OnlineClass right) {
        if (left.getCreatedAt() != null && right.getCreatedAt() != null) {
            return left.getCreatedAt().isAfter(right.getCreatedAt());
        }
        return left.getScheduledStartAt().isAfter(right.getScheduledStartAt());
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
                isWithinJoinWindow(onlineClass));
    }

    private Instant now() {
        return clock.instant();
    }
}
