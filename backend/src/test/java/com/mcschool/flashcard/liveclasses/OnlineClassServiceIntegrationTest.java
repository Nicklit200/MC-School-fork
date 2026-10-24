package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.GoogleCalendarLessonService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassConnectionResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Lifecycle, join-window and connection-authorization behaviour.
 *
 * <p>Runs against real PostgreSQL with a fixed clock and a stubbed media
 * provider, so no LiveKit credentials are needed.
 */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.livekit-url=wss://test.invalid",
        "app.online-classes.livekit-api-key=test-key",
        "app.online-classes.livekit-api-secret=test-secret",
        "app.online-classes.join-window-before-start=15m",
        "app.online-classes.join-window-after-end=60m"
})
@Import(OnlineClassServiceIntegrationTest.FixedClockConfiguration.class)
class OnlineClassServiceIntegrationTest extends AbstractIntegrationTest {

    /** 10:30 — inside a 10:00–11:00 lesson. */
    static final Instant NOW = Instant.parse("2026-09-18T10:30:00Z");
    private static final Instant LESSON_START = Instant.parse("2026-09-18T10:00:00Z");
    private static final Instant LESSON_END = Instant.parse("2026-09-18T11:00:00Z");

    @TestConfiguration
    static class FixedClockConfiguration {
        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }
    }

    @Autowired
    private OnlineClassService service;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private UserRepository userRepository;

    @MockitoBean
    private GoogleCalendarLessonService lessonService;

    @MockitoBean
    private LiveClassMediaProvider mediaProvider;

    private User teacher;
    private User otherTeacher;
    private User student;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local",
                "t1", NOW.plusSeconds(3600)));
        otherTeacher = userRepository.save(User.invitedTeacher("Other", "other@test.local",
                "t2", NOW.plusSeconds(3600)));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local", teacher,
                "s1", NOW.plusSeconds(3600)));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        studentPrincipal = new AuthenticatedUser(student.getId(), student.getEmail(), student.getRole());

        when(lessonService.listGroupLessons(any())).thenReturn(List.of(lesson()));
        when(mediaProvider.isConfigured()).thenReturn(true);
        when(mediaProvider.createConnection(anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> new ParticipantConnection(
                        "wss://test.invalid",
                        "issued-token",
                        invocation.getArgument(1),
                        invocation.getArgument(0),
                        NOW.plusSeconds(600)));
    }

    private GroupLessonResponse lesson() {
        return new GroupLessonResponse("event-1", "binding-1", null, null,
                student.getId(), "Student", List.of(student.getId()), "Maths", LESSON_START, LESSON_END,
                "https://meet.example/abc", "https://calendar.example/abc");
    }

    private OnlineClass materialize() {
        OnlineClassResponse response = service.materializeFromCalendar(teacherPrincipal, "event-1");
        return classRepository.findById(response.id()).orElseThrow();
    }

    // --- Materialization -----------------------------------------------------

    @Test
    void materializingTwiceReturnsTheSameClass() {
        OnlineClassResponse first = service.materializeFromCalendar(teacherPrincipal, "event-1");
        OnlineClassResponse second = service.materializeFromCalendar(teacherPrincipal, "event-1");

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(classRepository.count()).isEqualTo(1);
    }

    @Test
    void materializedClassSnapshotsTheLesson() {
        OnlineClassResponse response = service.materializeFromCalendar(teacherPrincipal, "event-1");

        assertThat(response.title()).isEqualTo("Maths");
        assertThat(response.scheduledStartAt()).isEqualTo(LESSON_START);
        assertThat(response.studentId()).isEqualTo(student.getId());
        assertThat(response.status()).isEqualTo(OnlineClassStatus.SCHEDULED);
        assertThat(response.viewerIsHost()).isTrue();
    }

    @Test
    void aTeacherCannotMaterializeALessonThatIsNotTheirs() {
        // The other teacher's calendar listing does not contain this event.
        AuthenticatedUser intruder = new AuthenticatedUser(
                otherTeacher.getId(), otherTeacher.getEmail(), otherTeacher.getRole());
        when(lessonService.listGroupLessons(any())).thenReturn(List.of());

        assertThatThrownBy(() -> service.materializeFromCalendar(intruder, "event-1"))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(classRepository.count()).isZero();
    }

    @Test
    void anUnknownEventIsNotFound() {
        assertThatThrownBy(() -> service.materializeFromCalendar(teacherPrincipal, "event-missing"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- Lifecycle -----------------------------------------------------------

    @Test
    void lifecycleIsIdempotentAndCreatesTheHostParticipant() {
        OnlineClass onlineClass = materialize();

        service.openLobby(teacherPrincipal, onlineClass.getId());
        service.openLobby(teacherPrincipal, onlineClass.getId());
        service.start(teacherPrincipal, onlineClass.getId());
        service.start(teacherPrincipal, onlineClass.getId());

        OnlineClass reloaded = classRepository.findById(onlineClass.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(reloaded.getActualStartAt()).isEqualTo(NOW);
        // Exactly one host participant row despite repeated calls.
        assertThat(participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(onlineClass.getId()))
                .hasSize(1)
                .allMatch(OnlineClassParticipant::isHost);
    }

    @Test
    void endingCreditsAttendanceForStillConnectedParticipants() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        service.connect(teacherPrincipal, onlineClass.getId(), "tab-1");

        service.end(teacherPrincipal, onlineClass.getId());

        OnlineClassParticipant host = participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), teacher.getId()).orElseThrow();
        assertThat(host.isConnected()).isFalse();
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getStatus())
                .isEqualTo(OnlineClassStatus.ENDED);
    }

    @Test
    void startingWithAnUnconfiguredProviderIsAClearConflictNotA500() {
        // Regression: ensureRoom threw straight out of the service, surfacing as
        // an unhandled 500 instead of a teacher-facing message.
        when(mediaProvider.isConfigured()).thenReturn(false);
        OnlineClass onlineClass = materialize();

        assertThatThrownBy(() -> service.start(teacherPrincipal, onlineClass.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("not available");

        // And nothing was half-started.
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getStatus())
                .isEqualTo(OnlineClassStatus.SCHEDULED);
    }

    @Test
    void aProviderOutageDuringStartIsReportedNotThrownRaw() {
        OnlineClass onlineClass = materialize();
        org.mockito.Mockito.doThrow(new com.mcschool.flashcard.liveclasses.provider.MediaProviderException("down"))
                .when(mediaProvider).ensureRoom(anyString());

        assertThatThrownBy(() -> service.start(teacherPrincipal, onlineClass.getId()))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void openingTheLobbyWithAnUnconfiguredProviderIsAClearConflict() {
        when(mediaProvider.isConfigured()).thenReturn(false);
        OnlineClass onlineClass = materialize();

        assertThatThrownBy(() -> service.openLobby(teacherPrincipal, onlineClass.getId()))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void aStudentCannotDriveTheLifecycle() {
        OnlineClass onlineClass = materialize();

        assertThatThrownBy(() -> service.start(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.end(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- Connection ----------------------------------------------------------

    @Test
    void studentGetsATokenOnceAdmittedToALiveClass() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        // start() bumped the row's version in its own transaction, so re-read
        // rather than writing through the now-stale instance.
        OnlineClass reloaded = classRepository.findById(onlineClass.getId()).orElseThrow();
        reloaded.setWaitingRoomEnabled(false);
        classRepository.save(reloaded);

        OnlineClassConnectionResponse connection =
                service.connect(studentPrincipal, onlineClass.getId(), "tab-1");

        assertThat(connection.token()).isEqualTo("issued-token");
        assertThat(connection.serverUrl()).isEqualTo("wss://test.invalid");
        assertThat(connection.host()).isFalse();
        // The identity must embed the user id so webhooks can be attributed.
        assertThat(ParticipantIdentity.userId(connection.identity())).contains(student.getId());
    }

    @Test
    void aWaitingStudentIsNotGivenAToken() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());

        assertThatThrownBy(() -> service.connect(studentPrincipal, onlineClass.getId(), "tab-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("admit");
    }

    @Test
    void aDeclinedStudentIsToldSoInsteadOfWaitingForever() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        OnlineClassParticipant participant = participantRepository.save(
                OnlineClassParticipant.student(onlineClass, student));
        participant.reject();
        participantRepository.save(participant);

        // The client keeps polling while it hears "admit"; a distinct answer is
        // what lets it stop.
        assertThatThrownBy(() -> service.connect(studentPrincipal, onlineClass.getId(), "tab-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("declined")
                .hasMessageNotContaining("admit");
    }

    @Test
    void aRemovedStudentIsNeverGivenANewToken() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        OnlineClassParticipant participant = participantRepository.save(
                OnlineClassParticipant.student(onlineClass, student));
        participant.remove();
        participantRepository.save(participant);

        assertThatThrownBy(() -> service.connect(studentPrincipal, onlineClass.getId(), "tab-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("removed");
    }

    @Test
    void nobodyConnectsToAClassThatHasNotOpened() {
        OnlineClass onlineClass = materialize();

        assertThatThrownBy(() -> service.connect(teacherPrincipal, onlineClass.getId(), "tab-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("not open");
    }

    @Test
    void anUnrelatedStudentCannotConnect() {
        User outsider = userRepository.save(User.invitedStudent("Outsider", "outsider@test.local",
                teacher, "s2", NOW.plusSeconds(3600)));
        AuthenticatedUser outsiderPrincipal =
                new AuthenticatedUser(outsider.getId(), outsider.getEmail(), outsider.getRole());
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());

        assertThatThrownBy(() -> service.connect(outsiderPrincipal, onlineClass.getId(), "tab-1"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- Join window ---------------------------------------------------------

    @Test
    void joinWindowOpensBeforeTheLessonAndClosesAfterIt() {
        OnlineClass onlineClass = materialize();

        // NOW is 10:30, inside the 09:45–12:00 window for a 10:00–11:00 lesson.
        assertThat(service.isWithinJoinWindow(onlineClass)).isTrue();

        OnlineClass tooEarly = classRepository.save(OnlineClass.forStudent(teacher, "event-early",
                "binding-1", "Maths", NOW.plus(2, ChronoUnit.HOURS), NOW.plus(3, ChronoUnit.HOURS), student));
        assertThat(service.isWithinJoinWindow(tooEarly)).isFalse();

        OnlineClass longOver = classRepository.save(OnlineClass.forStudent(teacher, "event-old",
                "binding-1", "Maths", NOW.minus(5, ChronoUnit.HOURS), NOW.minus(4, ChronoUnit.HOURS), student));
        assertThat(service.isWithinJoinWindow(longOver)).isFalse();
    }

    @Test
    void aStudentCannotMintATokenForAHistoricalLesson() {
        OnlineClass longOver = classRepository.save(OnlineClass.forStudent(teacher, "event-old",
                "binding-1", "Maths", NOW.minus(5, ChronoUnit.HOURS), NOW.minus(4, ChronoUnit.HOURS), student));
        longOver.setWaitingRoomEnabled(false);
        longOver.start(NOW.minus(5, ChronoUnit.HOURS));
        classRepository.save(longOver);

        assertThatThrownBy(() -> service.connect(studentPrincipal, longOver.getId(), "tab-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("not open for joining");
        assertThat(service.get(studentPrincipal, longOver.getId()).joinWindowOpen()).isFalse();
        assertThat(service.listUpcoming(studentPrincipal)).isEmpty();
    }

    @Test
    void explicitlyOpeningALateLessonMakesItDiscoverableAndJoinable() {
        OnlineClass late = classRepository.save(OnlineClass.forStudent(teacher, "event-late",
                "binding-late", "Late lesson", NOW.minus(6, ChronoUnit.HOURS),
                NOW.minus(5, ChronoUnit.HOURS), student));
        late.setWaitingRoomEnabled(false);
        classRepository.save(late);

        OnlineClassResponse lobby = service.openLobby(teacherPrincipal, late.getId());
        assertThat(lobby.joinWindowOpen()).isTrue();
        assertThat(service.listUpcoming(studentPrincipal)).extracting(OnlineClassResponse::id).contains(late.getId());
        assertThat(service.connect(studentPrincipal, late.getId(), "student-tab").token()).isNotBlank();

        Instant expiry = classRepository.findById(late.getId()).orElseThrow().getStudentJoinUntil();
        assertThat(expiry).isEqualTo(NOW.plus(2, ChronoUnit.HOURS));
        service.openLobby(teacherPrincipal, late.getId());
        assertThat(classRepository.findById(late.getId()).orElseThrow().getStudentJoinUntil()).isEqualTo(expiry);
        service.end(teacherPrincipal, late.getId());
        assertThat(service.get(studentPrincipal, late.getId()).joinWindowOpen()).isFalse();
        assertThat(service.listUpcoming(studentPrincipal)).isEmpty();
    }

    @Test
    void teacherRestartingExpiredSessionGetsAFreshRoomAndArchivesTheOldSession() {
        OnlineClass original = materialize();
        // The original calendar slot was much earlier than the current lesson.
        when(lessonService.listGroupLessons(any())).thenReturn(List.of(new GroupLessonResponse(
                "event-old-restart", "binding-old-restart", null, null,
                student.getId(), "Student", List.of(student.getId()), "Maths",
                NOW.minus(6, ChronoUnit.HOURS), NOW.minus(5, ChronoUnit.HOURS), null, null)));
        OnlineClassResponse scheduled = service.materializeFromCalendar(teacherPrincipal, "event-old-restart");
        OnlineClass expired = classRepository.findById(scheduled.id()).orElseThrow();
        expired.start(NOW.minus(6, ChronoUnit.HOURS));
        classRepository.save(expired); // legacy row without an explicit opening deadline

        OnlineClassResponse retry = service.materializeFromCalendar(teacherPrincipal, "event-old-restart");
        assertThat(retry.id()).isNotEqualTo(expired.getId()).isNotEqualTo(original.getId());
        assertThat(retry.scheduledStartAt()).isEqualTo(NOW);
        assertThat(service.get(teacherPrincipal, expired.getId()).status()).isEqualTo(OnlineClassStatus.ENDED);
        service.start(teacherPrincipal, retry.id());
        assertThat(service.listUpcoming(studentPrincipal)).extracting(OnlineClassResponse::id)
                .contains(retry.id()).doesNotContain(expired.getId());
        assertThat(service.materializeFromCalendar(teacherPrincipal, "event-old-restart").id()).isEqualTo(retry.id());
    }

    @Test
    void discoveryKeepsTheWholeGracePeriodAfterLessonEnd() {
        OnlineClass inGrace = classRepository.save(OnlineClass.forStudent(teacher, "event-grace",
                "binding-grace", "Maths", NOW.minus(90, ChronoUnit.MINUTES),
                NOW.minus(30, ChronoUnit.MINUTES), student));
        inGrace.start(NOW.minus(90, ChronoUnit.MINUTES));
        inGrace.setWaitingRoomEnabled(false);
        classRepository.save(inGrace);
        assertThat(service.listUpcoming(studentPrincipal)).extracting(OnlineClassResponse::id).contains(inGrace.getId());
        assertThat(service.connect(studentPrincipal, inGrace.getId(), "tab").token()).isNotBlank();
    }

    @Test
    void startingAnAlreadyOpenLobbyDoesNotSlideItsDeadline() {
        OnlineClass onlineClass = materialize();
        onlineClass.openLobby();
        Instant deadline = NOW.plus(30, ChronoUnit.MINUTES);
        onlineClass.allowStudentJoiningUntil(deadline);
        classRepository.save(onlineClass);
        service.start(teacherPrincipal, onlineClass.getId());
        service.start(teacherPrincipal, onlineClass.getId());
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getStudentJoinUntil()).isEqualTo(deadline);
    }

    @Test
    void anExplicitOpeningDeadlineStillExpiresForStudents() {
        OnlineClass expired = classRepository.save(OnlineClass.forStudent(teacher, "expired-open",
                "expired-open", "Maths", NOW.minus(6, ChronoUnit.HOURS), NOW.minus(5, ChronoUnit.HOURS), student));
        expired.start(NOW.minus(5, ChronoUnit.HOURS));
        expired.allowStudentJoiningUntil(NOW.minusSeconds(1));
        expired.setWaitingRoomEnabled(false);
        classRepository.save(expired);
        assertThat(service.listUpcoming(studentPrincipal)).isEmpty();
        assertThat(service.get(studentPrincipal, expired.getId()).joinWindowOpen()).isFalse();
        assertThatThrownBy(() -> service.connect(studentPrincipal, expired.getId(), "tab"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("not open for joining");
    }

    @Test
    void changingThePupilCreatesANewSessionWithoutGrantingOldPupilAccess() {
        OnlineClass original = materialize();
        service.start(teacherPrincipal, original.getId());
        User next = userRepository.save(User.invitedStudent("Next student", "next@test.local",
                teacher, "s-next", NOW.plusSeconds(3600)));
        when(lessonService.listGroupLessons(any())).thenReturn(List.of(new GroupLessonResponse(
                "event-1", "binding-1", null, null, next.getId(), "Next student", List.of(next.getId()),
                "Maths", LESSON_START, LESSON_END, null, null)));

        OnlineClassResponse replacement = service.materializeFromCalendar(teacherPrincipal, "event-1");
        assertThat(replacement.id()).isNotEqualTo(original.getId());
        assertThat(replacement.studentId()).isEqualTo(next.getId());
        assertThat(service.get(teacherPrincipal, original.getId()).status()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(service.listUpcoming(studentPrincipal)).isEmpty();
        assertThatThrownBy(() -> service.connect(studentPrincipal, replacement.id(), "old-pupil"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void parallelRetriesReuseOneFreshSession() throws Exception {
        OnlineClass original = materialize();
        service.end(teacherPrincipal, original.getId());
        var executor = java.util.concurrent.Executors.newFixedThreadPool(2);
        var start = new java.util.concurrent.CountDownLatch(1);
        try {
            java.util.concurrent.Callable<UUID> retry = () -> {
                start.await();
                return service.materializeFromCalendar(teacherPrincipal, "event-1").id();
            };
            var first = executor.submit(retry);
            var second = executor.submit(retry);
            start.countDown();
            UUID firstId = first.get(15, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(second.get(15, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(firstId);
            assertThat(classRepository.findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(teacher.getId(), "event-1"))
                    .hasSize(2);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void retryOpenedBeforeAFutureCalendarSlotIsReused() {
        when(lessonService.listGroupLessons(any())).thenReturn(List.of(new GroupLessonResponse(
                "future-event", "future-event", null, null, student.getId(), "Student", List.of(student.getId()),
                "Maths", NOW.plus(1, ChronoUnit.DAYS), NOW.plus(25, ChronoUnit.HOURS), null, null)));
        OnlineClassResponse original = service.materializeFromCalendar(teacherPrincipal, "future-event");
        service.end(teacherPrincipal, original.id());
        OnlineClassResponse retry = service.materializeFromCalendar(teacherPrincipal, "future-event");
        service.start(teacherPrincipal, retry.id());
        assertThat(service.materializeFromCalendar(teacherPrincipal, "future-event").id()).isEqualTo(retry.id());
    }

    @Test
    void theTeacherMayOpenAndJoinBeforeTheJoinWindow() {
        OnlineClass early = classRepository.save(OnlineClass.forStudent(teacher, "event-early",
                "binding-1", "Maths", NOW.plus(2, ChronoUnit.HOURS), NOW.plus(3, ChronoUnit.HOURS), student));
        service.start(teacherPrincipal, early.getId());

        OnlineClassConnectionResponse connection =
                service.connect(teacherPrincipal, early.getId(), "tab-1");

        assertThat(connection.host()).isTrue();
        assertThat(connection.token()).isNotBlank();
    }

    @Test
    void teacherCanProbeWhetherLiveKitRoomApiRespondsWithoutGettingCredentials() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());

        // A successful, owner-only room API check is reported as a boolean.
        assertThat(service.checkMediaApi(teacherPrincipal, onlineClass.getId())).isTrue();

        // Even a valid teacher account cannot inspect someone else's room.
        AuthenticatedUser intruder = new AuthenticatedUser(
                otherTeacher.getId(), otherTeacher.getEmail(), otherTeacher.getRole());
        assertThatThrownBy(() -> service.checkMediaApi(intruder, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void liveKitApiFailureIsReportedAsUnavailableWithoutLeakingErrorToCaller() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        doThrow(new MediaProviderException("LiveKit request failed with HTTP 401"))
                .when(mediaProvider).ensureRoom(onlineClass.getRoomName());

        assertThat(service.checkMediaApi(teacherPrincipal, onlineClass.getId())).isFalse();
        assertThat(service.diagnoseMediaApi(teacherPrincipal, onlineClass.getId()).status())
                .isEqualTo("AUTH_REJECTED");
    }

    @Test
    void mediaApiProbeDistinguishesServerOutageFromCredentialRejection() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        doThrow(new MediaProviderException("LiveKit request failed"))
                .when(mediaProvider).ensureRoom(onlineClass.getRoomName());

        var diagnosis = service.diagnoseMediaApi(teacherPrincipal, onlineClass.getId());
        assertThat(diagnosis.reachable()).isFalse();
        assertThat(diagnosis.status()).isEqualTo("UNREACHABLE");
    }

    // --- Discovery -----------------------------------------------------------

    @Test
    void studentsOnlySeeTheirOwnClasses() {
        materialize();
        User outsider = userRepository.save(User.invitedStudent("Outsider", "outsider@test.local",
                teacher, "s2", NOW.plusSeconds(3600)));

        List<OnlineClassResponse> mine = service.listUpcoming(studentPrincipal);
        List<OnlineClassResponse> theirs = service.listUpcoming(
                new AuthenticatedUser(outsider.getId(), outsider.getEmail(), outsider.getRole()));

        assertThat(mine).hasSize(1);
        assertThat(theirs).isEmpty();
    }

    @Test
    void leaveRecordsAttendanceWithoutEndingTheClass() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        service.connect(teacherPrincipal, onlineClass.getId(), "tab-1");

        service.leave(teacherPrincipal, onlineClass.getId());

        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getStatus())
                .isEqualTo(OnlineClassStatus.LIVE);
        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), teacher.getId())
                .orElseThrow().isConnected()).isFalse();
    }

    @Test
    void connectingFromTwoTabsYieldsDistinctIdentitiesForOneParticipantRow() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());

        OnlineClassConnectionResponse first =
                service.connect(teacherPrincipal, onlineClass.getId(), "tab-1");
        OnlineClassConnectionResponse second =
                service.connect(teacherPrincipal, onlineClass.getId(), "tab-2");

        assertThat(first.identity()).isNotEqualTo(second.identity());
        assertThat(ParticipantIdentity.userId(first.identity()))
                .isEqualTo(ParticipantIdentity.userId(second.identity()));
        assertThat(participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(onlineClass.getId()))
                .hasSize(1);
    }

    @Test
    void identityCarriesNoPersonalData() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());

        String identity = service.connect(teacherPrincipal, onlineClass.getId(), "tab-1").identity();

        assertThat(identity)
                .doesNotContain("teacher@test.local")
                .doesNotContain("Teacher");
        assertThat(UUID.fromString(identity.split("\\|")[0])).isEqualTo(teacher.getId());
    }
}
