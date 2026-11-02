package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.GoogleCalendarLessonService;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassConnectionResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentRequest;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentResponse;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.ClassTranscriptionProvider;
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

    @Autowired
    private OnlineClassTranscriptService transcriptService;

    @Autowired
    private OnlineClassTranscriptSegmentRepository segmentRepository;

    @Autowired
    private LessonPreparationRepository preparations;

    @MockitoBean
    private GoogleCalendarLessonService lessonService;

    @MockitoBean
    private LiveClassMediaProvider mediaProvider;

    @MockitoBean
    private ClassTranscriptionProvider transcriptionProvider;

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
        // Existing admission tests model a teacher who has already entered.
        // Empty-room and token-only cases override this provider snapshot.
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of(
                ParticipantIdentity.of(teacher.getId(), "teacher-tab")));
        when(transcriptionProvider.isConfigured()).thenReturn(true);
        when(transcriptionProvider.isTranscriptionRunning(anyString(), anyString())).thenReturn(true);
        when(transcriptionProvider.startTranscription(anyString(), anyString(), any(), any()))
                .thenReturn("dispatch-1");
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
                student.getId(), "Student", java.util.List.of(student.getId()), "Maths", LESSON_START, LESSON_END,
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
    void openingTheLobbyAndStartingBeforeMediaConnectionNeverDispatchesTranscription() {
        OnlineClass onlineClass = materialize();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());

        OnlineClassResponse lobby = service.openLobby(teacherPrincipal, onlineClass.getId());
        assertThat(lobby.status()).isEqualTo(OnlineClassStatus.LOBBY_OPEN);
        assertThat(lobby.transcriptionState()).isEqualTo(ClassFeatureState.INACTIVE);

        OnlineClassResponse started = service.start(teacherPrincipal, onlineClass.getId());
        assertThat(started.status()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(started.mediaState()).isEqualTo("IDLE");
        assertThat(started.transcriptionState()).isEqualTo(ClassFeatureState.INACTIVE);
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow()
                .getTranscriptionDispatchId()).isNull();
        verify(transcriptionProvider, never()).startTranscription(anyString(), anyString(), any(), any());
        verify(mediaProvider, never()).ensureRoom(anyString());
    }

    @Test
    void issuingAHostConnectionTokenDoesNotDispatchTranscription() {
        OnlineClass onlineClass = materialize();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        service.start(teacherPrincipal, onlineClass.getId());

        OnlineClassConnectionResponse issued = service.connect(
                teacherPrincipal, onlineClass.getId(), "unconnected-tab");

        assertThat(issued.token()).isEqualTo("issued-token");
        assertThat(participantRepository.findByOnlineClassIdAndUserId(
                onlineClass.getId(), teacher.getId()).orElseThrow().isConnected()).isTrue();
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow()
                .getTranscriptionState()).isEqualTo(ClassFeatureState.INACTIVE);
        verify(transcriptionProvider, never()).startTranscription(anyString(), anyString(), any(), any());
        verify(mediaProvider, never()).ensureRoom(anyString());
    }

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
        when(mediaProvider.listParticipantIdentities(anyString()))
                .thenThrow(new MediaProviderException("down"));

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
    void anAdmittedStudentWaitsForTheTeacherInsteadOfWakingAnEmptyRoom() {
        OnlineClass room = materialize();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        service.start(teacherPrincipal, room.getId());
        room = classRepository.findById(room.getId()).orElseThrow();
        room.setWaitingRoomEnabled(false);
        classRepository.saveAndFlush(room);
        UUID classId = room.getId();

        assertThatThrownBy(() -> service.connect(studentPrincipal, classId, "student-first"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Waiting for the teacher to enter");

        assertThat(service.get(studentPrincipal, classId).status()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(service.get(studentPrincipal, classId).mediaState()).isEqualTo("IDLE");
        verify(mediaProvider, never()).createConnection(anyString(), anyString(), anyString(), any(), any());
        verify(mediaProvider, never()).ensureRoom(anyString());
        verify(transcriptionProvider, never()).startTranscription(anyString(), anyString(), any(), any());
    }

    @Test
    void anAgentAloneDoesNotCountAsTheTeacherForStudentEntry() {
        OnlineClass room = materialize();
        service.start(teacherPrincipal, room.getId());
        room = classRepository.findById(room.getId()).orElseThrow();
        room.setWaitingRoomEnabled(false);
        classRepository.saveAndFlush(room);
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of("agent-transcriber-job"));
        UUID classId = room.getId();

        assertThatThrownBy(() -> service.connect(studentPrincipal, classId, "student-first"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Waiting for the teacher to enter");

        verify(mediaProvider, never()).createConnection(anyString(), anyString(), anyString(), any(), any());
        assertThat(classRepository.findById(classId).orElseThrow().getStatus()).isEqualTo(OnlineClassStatus.LIVE);
    }

    @Test
    void aTeacherTokenCanWakeANativeClosedRoomAndClearItsStaleDispatch() {
        OnlineClass room = activeTranscriptionRoom();
        transcriptService.ingest(room.getId(), new TranscriptSegmentRequest("saved-before-native-close",
                ParticipantIdentity.of(student.getId(), "student-tab"), "Student", "de", 0, 500,
                "Existing lesson text", 0.9));
        Instant originalStart = room.getActualStartAt();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());

        OnlineClassConnectionResponse issued = service.connect(teacherPrincipal, room.getId(), "rejoined-host");

        assertThat(issued.token()).isEqualTo("issued-token");
        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(reloaded.getActualStartAt()).isEqualTo(originalStart);
        assertThat(reloaded.getActualEndAt()).isNull();
        assertThat(reloaded.getTranscriptionState()).isEqualTo(ClassFeatureState.INACTIVE);
        assertThat(reloaded.getTranscriptionDispatchId()).isNull();
        assertThat(segmentRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(room.getId()))
                .extracting(OnlineClassTranscriptSegment::getText).containsExactly("Existing lesson text");
        verify(transcriptionProvider).stopTranscription(room.getRoomName(), "dispatch-1");
        verify(transcriptionProvider, never()).startTranscription(anyString(), anyString(), any(), any());
        verify(mediaProvider, never()).ensureRoom(anyString());
    }

    @Test
    void teacherReentryDuringAgentOnlyGraceKeepsTheExistingDispatch() {
        OnlineClass room = activeTranscriptionRoom();
        observeEmptySince(room.getId(), NOW.minusSeconds(20));
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of("agent-transcriber-job"));

        assertThat(service.connect(teacherPrincipal, room.getId(), "new-host-tab").token()).isNotBlank();

        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.getTranscriptionDispatchId()).isEqualTo("dispatch-1");
        assertThat(reloaded.getTranscriptionState()).isEqualTo(ClassFeatureState.ACTIVE);
        assertThat(classRepository.count()).isEqualTo(1);
        verify(transcriptionProvider, never()).stopTranscription(anyString(), anyString());
        verify(transcriptionProvider, never()).startTranscription(anyString(), anyString(), any(), any());
    }

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
    void joinWindowIsTheBerlinCalendarDayNotTheScheduledHour() {
        assertThat(service.isWithinJoinWindow(materialize())).isTrue();
        OnlineClass evening = OnlineClass.forStudent(teacher, "evening", "b", "Maths", NOW.plus(2, ChronoUnit.HOURS), NOW.plus(3, ChronoUnit.HOURS), student);
        assertThat(service.isWithinJoinWindow(evening)).isTrue();
        OnlineClass yesterday = OnlineClass.forStudent(teacher, "yesterday", "b", "Maths", NOW.minus(1, ChronoUnit.DAYS), NOW.minus(23, ChronoUnit.HOURS), student);
        assertThat(service.isWithinJoinWindow(yesterday)).isFalse();
        OnlineClass tomorrow = OnlineClass.forStudent(teacher, "tomorrow", "b", "Maths", NOW.plus(1, ChronoUnit.DAYS), NOW.plus(25, ChronoUnit.HOURS), student);
        assertThat(service.isWithinJoinWindow(tomorrow)).isFalse();
    }

    @Test
    void aStudentCannotMintATokenForAHistoricalLessonWithoutItsTeacher() {
        OnlineClass longOver = classRepository.save(OnlineClass.forStudent(teacher, "event-old",
                "binding-1", "Maths", NOW.minus(1, ChronoUnit.DAYS), NOW.minus(23, ChronoUnit.HOURS), student));
        longOver.setWaitingRoomEnabled(false);
        longOver.start(NOW.minus(1, ChronoUnit.DAYS));
        classRepository.save(longOver);
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());

        assertThatThrownBy(() -> service.connect(studentPrincipal, longOver.getId(), "tab-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Waiting for the teacher");
        assertThat(service.get(studentPrincipal, longOver.getId()).joinWindowOpen()).isFalse();
        assertThat(service.listUpcoming(studentPrincipal)).noneMatch(OnlineClassResponse::joinWindowOpen);
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
        assertThat(expiry).isEqualTo(LessonEntryPolicy.dayEnd(late.getScheduledStartAt()));
        service.openLobby(teacherPrincipal, late.getId());
        assertThat(classRepository.findById(late.getId()).orElseThrow().getStudentJoinUntil()).isEqualTo(expiry);
        service.end(teacherPrincipal, late.getId());
        assertThat(service.get(studentPrincipal, late.getId()).joinWindowOpen()).isFalse();
        assertThat(service.listUpcoming(studentPrincipal)).allMatch(item -> !item.joinWindowOpen() && item.entryState().equals("ENDED"));
    }

    @Test
    void anEndedOccurrenceCannotBeReopenedByMaterializingItAgain() {
        OnlineClass original = materialize();
        service.start(teacherPrincipal, original.getId());
        service.end(teacherPrincipal, original.getId());
        OnlineClassResponse repeated = service.materializeFromCalendar(teacherPrincipal, "event-1");
        assertThat(repeated.id()).isEqualTo(original.getId());
        assertThat(repeated.entryState()).isEqualTo("ENDED");
        assertThatThrownBy(() -> service.start(teacherPrincipal, repeated.id())).isInstanceOf(ConflictException.class).hasMessageContaining("has ended");
        assertThat(classRepository.count()).isEqualTo(1);
    }

    @Test
    void changingTheCalendarDateDoesNotReplaceAnExistingLessonOrItsTranscript() {
        OnlineClass original = activeTranscriptionRoom();
        transcriptService.ingest(original.getId(), new TranscriptSegmentRequest("before-date-correction",
                ParticipantIdentity.of(teacher.getId(), "teacher-tab"), "Teacher", "de", 0, 500,
                "Keep this saved text", 0.9));
        when(lessonService.listGroupLessons(any())).thenReturn(List.of(new GroupLessonResponse(
                "event-1", "binding-1", null, null, student.getId(), "Student", List.of(student.getId()),
                "Maths", LESSON_START.plus(7, ChronoUnit.DAYS), LESSON_END.plus(7, ChronoUnit.DAYS), null, null)));

        OnlineClassResponse repeated = service.materializeFromCalendar(teacherPrincipal, "event-1");

        assertThat(repeated.id()).isEqualTo(original.getId());
        assertThat(service.start(teacherPrincipal, repeated.id()).actualStartAt()).isEqualTo(NOW);
        assertThat(transcriptService.segments(teacherPrincipal, repeated.id()))
                .extracting(TranscriptSegmentResponse::text).containsExactly("Keep this saved text");
        assertThat(classRepository.count()).isEqualTo(1);
        service.end(teacherPrincipal, repeated.id());
        assertThat(service.materializeFromCalendar(teacherPrincipal, "event-1").id()).isEqualTo(original.getId());
        assertThatThrownBy(() -> service.start(teacherPrincipal, original.getId()))
                .isInstanceOf(ConflictException.class).hasMessageContaining("has ended");
        assertThat(classRepository.count()).isEqualTo(1);
    }

    @Test
    void anOngoingLessonRemainsJoinableAfterItsScheduledHourOnTheSameDay() {
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
        Instant deadline = LessonEntryPolicy.dayEnd(onlineClass.getScheduledStartAt());
        onlineClass.allowStudentJoiningUntil(deadline);
        classRepository.save(onlineClass);
        service.start(teacherPrincipal, onlineClass.getId());
        service.start(teacherPrincipal, onlineClass.getId());
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow().getStudentJoinUntil()).isEqualTo(deadline);
    }

    @Test
    void aLegacyOpeningExtensionCannotGrantFirstEntryWithoutTheTeacher() {
        OnlineClass expired = classRepository.save(OnlineClass.forStudent(teacher, "expired-open", "expired-open", "Maths",
                NOW.minus(1, ChronoUnit.DAYS), NOW.minus(23, ChronoUnit.HOURS), student));
        expired.start(NOW.minus(1, ChronoUnit.DAYS));
        expired.allowStudentJoiningUntil(NOW.plus(1, ChronoUnit.DAYS));
        expired.setWaitingRoomEnabled(false); classRepository.save(expired);
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        assertThat(service.listUpcoming(studentPrincipal)).noneMatch(OnlineClassResponse::joinWindowOpen);
        assertThat(service.get(studentPrincipal, expired.getId()).joinWindowOpen()).isFalse();
        assertThatThrownBy(() -> service.connect(studentPrincipal, expired.getId(), "tab"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("Waiting for the teacher");
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
        assertThat(LessonEntryPolicy.lessonDate(replacement.scheduledStartAt()))
                .isEqualTo(LessonEntryPolicy.lessonDate(LESSON_START));
        assertThat(service.materializeFromCalendar(teacherPrincipal, "event-1").id()).isEqualTo(replacement.id());
        assertThat(classRepository.count()).isEqualTo(2);
        assertThat(service.get(teacherPrincipal, original.getId()).status()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(service.listUpcoming(studentPrincipal)).noneMatch(OnlineClassResponse::joinWindowOpen);
        assertThatThrownBy(() -> service.connect(studentPrincipal, replacement.id(), "old-pupil"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void parallelStartClicksKeepTheSameEndedOccurrence() throws Exception {
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
            assertThat(firstId).isEqualTo(original.getId());
            assertThat(classRepository.findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(teacher.getId(), "event-1"))
                    .hasSize(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void theTeacherCanEnterAFutureLessonButExplicitEndStillClosesIt() {
        when(lessonService.listGroupLessons(any())).thenReturn(List.of(new GroupLessonResponse(
                "future-event", "future-event", null, null, student.getId(), "Student", List.of(student.getId()),
                "Maths", NOW.plus(1, ChronoUnit.DAYS), NOW.plus(25, ChronoUnit.HOURS), null, null)));
        OnlineClassResponse original = service.materializeFromCalendar(teacherPrincipal, "future-event");
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        OnlineClassResponse started = service.start(teacherPrincipal, original.id());
        assertThat(started.joinWindowOpen()).isTrue();
        assertThat(started.viewerIsHost()).isTrue();
        assertThat(started.mediaState()).isEqualTo("IDLE");
        assertThat(service.connect(teacherPrincipal, original.id(), "prepare-tomorrow").host()).isTrue();
        assertThat(service.get(studentPrincipal, original.id()).joinWindowOpen()).isFalse();
        assertThatThrownBy(() -> service.connect(studentPrincipal, original.id(), "too-early-student"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("teacher");
        verify(mediaProvider, never()).ensureRoom(anyString());
        verify(transcriptionProvider, never()).startTranscription(anyString(), anyString(), any(), any());
        service.end(teacherPrincipal, original.id());
        assertThat(service.materializeFromCalendar(teacherPrincipal, "future-event").id()).isEqualTo(original.id());
        assertThatThrownBy(() -> service.start(teacherPrincipal, original.id())).isInstanceOf(ConflictException.class).hasMessageContaining("has ended");
        assertThatThrownBy(() -> service.connect(teacherPrincipal, original.id(), "after-end"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("not open");
        assertThat(classRepository.count()).isEqualTo(1);
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
        verify(mediaProvider, never()).ensureRoom(anyString());

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
        when(mediaProvider.listParticipantIdentities(onlineClass.getRoomName()))
                .thenThrow(new MediaProviderException("LiveKit presence check failed with HTTP 401"));

        assertThat(service.checkMediaApi(teacherPrincipal, onlineClass.getId())).isFalse();
        assertThat(service.diagnoseMediaApi(teacherPrincipal, onlineClass.getId()).status())
                .isEqualTo("AUTH_REJECTED");
    }

    @Test
    void mediaApiProbeDistinguishesServerOutageFromCredentialRejection() {
        OnlineClass onlineClass = materialize();
        service.start(teacherPrincipal, onlineClass.getId());
        when(mediaProvider.listParticipantIdentities(onlineClass.getRoomName()))
                .thenThrow(new MediaProviderException("LiveKit presence check failed"));

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

    @Test
    void admittedStudentsCanEnterAndReconnectAfterMidnightWhileTheirTeacherIsPresent() {
        Instant yesterday = NOW.minus(1, ChronoUnit.DAYS);
        OnlineClass room = classRepository.save(OnlineClass.forStudent(teacher, "overnight", "overnight", "Maths", yesterday, yesterday.plusSeconds(3600), student));
        room.start(yesterday); classRepository.save(room);
        OnlineClassParticipant participant = OnlineClassParticipant.student(room, student);
        participant.admit(); participantRepository.save(participant);
        assertThat(service.connect(studentPrincipal, room.getId(), "first").token()).isNotBlank();
        assertThat(service.get(studentPrincipal, room.getId()).entryState()).isEqualTo("RECONNECT");
        assertThat(service.listUpcoming(studentPrincipal)).extracting(OnlineClassResponse::id).contains(room.getId());
        assertThat(service.connect(studentPrincipal, room.getId(), "reconnect").token()).isNotBlank();
        service.end(teacherPrincipal, room.getId());
        assertThatThrownBy(() -> service.connect(studentPrincipal, room.getId(), "again")).isInstanceOf(ConflictException.class);
    }

    @Test
    void anEmptyRoomDoesNotEndAfterTenMinutes() {
        OnlineClass room = materialize(); service.start(teacherPrincipal, room.getId());
        room = classRepository.findById(room.getId()).orElseThrow();
        room.observeEmpty(NOW.minusSeconds(3600)); classRepository.save(room);
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        service.reconcileIdleSession(room.getId());
        assertThat(service.get(teacherPrincipal, room.getId()).status()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(service.get(teacherPrincipal, room.getId()).actualEndAt()).isNull();
        assertThat(service.get(teacherPrincipal, room.getId()).mediaState()).isEqualTo("IDLE");
        verify(mediaProvider).closeRoom(room.getRoomName());
    }

    @Test
    void anAgentOnlyRoomGetsSixtySecondsBeforePhysicalMediaCleanup() {
        OnlineClass room = activeTranscriptionRoom();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of("agent-transcriber-job"));

        service.reconcileIdleSession(room.getId());
        assertThat(classRepository.findById(room.getId()).orElseThrow().getEmptySince()).isEqualTo(NOW);
        verify(mediaProvider, never()).closeRoom(anyString());
        verify(transcriptionProvider, never()).stopTranscription(anyString(), anyString());

        observeEmptySince(room.getId(), NOW.minusSeconds(59));
        service.reconcileIdleSession(room.getId());
        verify(mediaProvider, never()).closeRoom(anyString());

        observeEmptySince(room.getId(), NOW.minusSeconds(60));
        service.reconcileIdleSession(room.getId());

        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(reloaded.getActualEndAt()).isNull();
        assertThat(reloaded.getTranscriptionState()).isEqualTo(ClassFeatureState.INACTIVE);
        assertThat(reloaded.getTranscriptionDispatchId()).isNull();
        assertThat(reloaded.isMediaClosePending()).isFalse();
        verify(transcriptionProvider).stopTranscription(room.getRoomName(), "dispatch-1");
        verify(mediaProvider).closeRoom(room.getRoomName());
    }

    @Test
    void aHumanReturningAtTheFinalEmptyCheckCancelsCleanup() {
        OnlineClass room = activeTranscriptionRoom();
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(room.getRoomName())).thenReturn(
                List.of("agent-transcriber-job"),
                List.of("agent-transcriber-job", ParticipantIdentity.of(teacher.getId(), "returned")));

        service.reconcileIdleSession(room.getId());

        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.getEmptySince()).isNull();
        assertThat(reloaded.getTranscriptionDispatchId()).isEqualTo("dispatch-1");
        assertThat(service.get(teacherPrincipal, room.getId()).mediaState()).isEqualTo("ACTIVE");
        verify(transcriptionProvider, never()).stopTranscription(anyString(), anyString());
        verify(mediaProvider, never()).closeRoom(anyString());
    }

    @Test
    void aStudentStillInTheRoomPreventsEmptyRoomCleanup() {
        OnlineClass room = activeTranscriptionRoom();
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(
                "agent-transcriber-job", ParticipantIdentity.of(student.getId(), "still-learning")));

        service.reconcileIdleSession(room.getId());

        assertThat(classRepository.findById(room.getId()).orElseThrow().getEmptySince()).isNull();
        verify(transcriptionProvider, never()).stopTranscription(anyString(), anyString());
        verify(mediaProvider, never()).closeRoom(anyString());
    }

    @Test
    void physicalIdleCleanupAndTeacherReentryPreserveTheSameLessonAndTranscript() {
        OnlineClass room = activeTranscriptionRoom();
        transcriptService.ingest(room.getId(), new TranscriptSegmentRequest("before-idle",
                ParticipantIdentity.of(student.getId(), "student-tab"), "Student", "de", 0, 500,
                "Before idle", 0.9));
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        service.reconcileIdleSession(room.getId());

        assertThat(service.get(teacherPrincipal, room.getId()).mediaState()).isEqualTo("IDLE");
        assertThat(service.connect(teacherPrincipal, room.getId(), "rejoined-host").token()).isNotBlank();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of(
                ParticipantIdentity.of(teacher.getId(), "rejoined-host")));
        when(transcriptionProvider.startTranscription(anyString(), anyString(), any(), any()))
                .thenReturn("dispatch-after-idle");
        transcriptService.start(teacherPrincipal, room.getId(), List.of("de"));
        transcriptService.ingest(room.getId(), new TranscriptSegmentRequest("after-idle",
                ParticipantIdentity.of(student.getId(), "new-student-tab"), "Student", "de", 3000, 3500,
                "After reentry", 0.9));

        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.getActualStartAt()).isEqualTo(NOW);
        assertThat(reloaded.getActualEndAt()).isNull();
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(reloaded.getEventId()).isEqualTo("event-1");
        assertThat(reloaded.getTranscriptionDispatchId()).isEqualTo("dispatch-after-idle");
        assertThat(classRepository.count()).isEqualTo(1);
        assertThat(transcriptService.segments(teacherPrincipal, room.getId()))
                .extracting(TranscriptSegmentResponse::text).containsExactly("Before idle", "After reentry");
        verify(transcriptionProvider).startTranscription(org.mockito.ArgumentMatchers.eq(room.getRoomName()),
                org.mockito.ArgumentMatchers.eq(room.getId().toString()), any(),
                org.mockito.ArgumentMatchers.eq(NOW));
    }

    @Test
    void failedIdleRoomTeardownIsRetriedWithoutEndingTheLesson() {
        OnlineClass room = activeTranscriptionRoom();
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        doThrow(new MediaProviderException("unavailable")).when(mediaProvider).closeRoom(anyString());

        service.reconcileIdleSession(room.getId());

        OnlineClass failed = classRepository.findById(room.getId()).orElseThrow();
        assertThat(failed.isMediaClosePending()).isTrue();
        assertThat(failed.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(failed.getActualEndAt()).isNull();
        org.mockito.Mockito.doNothing().when(mediaProvider).closeRoom(anyString());
        service.reconcileIdleSession(room.getId());

        assertThat(classRepository.findById(room.getId()).orElseThrow().isMediaClosePending()).isFalse();
        assertThat(classRepository.findById(room.getId()).orElseThrow().getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        verify(mediaProvider, times(2)).closeRoom(room.getRoomName());
        verify(transcriptionProvider, times(1)).stopTranscription(room.getRoomName(), "dispatch-1");
    }

    @Test
    void aHumanReturnCancelsAnIdleTeardownRetry() {
        OnlineClass room = activeTranscriptionRoom();
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        doThrow(new MediaProviderException("unavailable")).when(mediaProvider).closeRoom(anyString());
        service.reconcileIdleSession(room.getId());
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of(
                ParticipantIdentity.of(teacher.getId(), "returned")));

        service.reconcileIdleSession(room.getId());

        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.isMediaClosePending()).isFalse();
        assertThat(reloaded.getEmptySince()).isNull();
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        verify(mediaProvider, times(1)).closeRoom(room.getRoomName());
    }

    @Test
    void aPresenceOutageCannotAuthorizeIdleTeardown() {
        OnlineClass room = activeTranscriptionRoom();
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(anyString()))
                .thenThrow(new MediaProviderException("presence unavailable"));

        service.reconcileIdleSession(room.getId());

        OnlineClass reloaded = classRepository.findById(room.getId()).orElseThrow();
        assertThat(reloaded.getTranscriptionDispatchId()).isEqualTo("dispatch-1");
        assertThat(reloaded.getTranscriptionState()).isEqualTo(ClassFeatureState.ACTIVE);
        assertThat(reloaded.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        verify(transcriptionProvider, never()).stopTranscription(anyString(), anyString());
        verify(mediaProvider, never()).closeRoom(anyString());
    }

    private OnlineClass activeTranscriptionRoom() {
        OnlineClass room = materialize();
        service.start(teacherPrincipal, room.getId());
        room = classRepository.findById(room.getId()).orElseThrow();
        room.setTranscriptionState(ClassFeatureState.ACTIVE);
        room.setTranscriptionDispatchId("dispatch-1");
        room.observeOccupied();
        return classRepository.saveAndFlush(room);
    }

    private void observeEmptySince(UUID classId, Instant since) {
        OnlineClass room = classRepository.findById(classId).orElseThrow();
        room.observeOccupied();
        room.observeEmpty(since);
        classRepository.saveAndFlush(room);
    }

    @Test
    void passingTheWeekBoundaryDoesNotEndAnOccupiedLesson() {
        Instant old = NOW.minus(8, ChronoUnit.DAYS);
        OnlineClass room = classRepository.save(OnlineClass.forStudent(teacher, "weekly-old",
                "weekly-old", "Maths", old, old.plus(1, ChronoUnit.HOURS), student));
        room.start(old); classRepository.save(room);
        service.reconcileIdleSession(room.getId());
        OnlineClassResponse hostView = service.get(teacherPrincipal, room.getId());
        assertThat(hostView.status()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(hostView.joinWindowOpen()).isTrue();
        assertThat(hostView.actualEndAt()).isNull();
        assertThat(service.get(studentPrincipal, room.getId()).joinWindowOpen()).isTrue();
        assertThat(service.get(studentPrincipal, room.getId()).teacherPresent()).isTrue();
        verify(mediaProvider, never()).closeRoom(anyString());
    }

    @Test
    void teacherCanFirstOpenAnOldLessonWithoutAStoredHostParticipant() {
        Instant old = NOW.minus(15, ChronoUnit.DAYS);
        OnlineClass room = classRepository.save(OnlineClass.forStudent(teacher, "old-unopened",
                "old-unopened", "Maths", old, old.plusSeconds(3600), student));
        assertThat(participantRepository.findByOnlineClassIdAndUserId(room.getId(), teacher.getId())).isEmpty();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());

        assertThat(service.checkMediaApi(teacherPrincipal, room.getId())).isTrue();
        OnlineClassResponse lobby = service.openLobby(teacherPrincipal, room.getId());
        assertThat(lobby.viewerIsHost()).isTrue();
        assertThat(lobby.joinWindowOpen()).isTrue();
        assertThat(service.start(teacherPrincipal, room.getId()).id()).isEqualTo(room.getId());
        assertThat(service.connect(teacherPrincipal, room.getId(), "first-entry-weeks-later").token()).isNotBlank();
        verify(mediaProvider, never()).ensureRoom(anyString());
        AuthenticatedUser outsider = new AuthenticatedUser(otherTeacher.getId(), otherTeacher.getEmail(), otherTeacher.getRole());
        assertThatThrownBy(() -> service.start(outsider, room.getId())).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void leavingAndResumingAnOldLessonAppendsToItsExistingArchiveUntilExplicitEnd() {
        Instant old = NOW.minus(15, ChronoUnit.DAYS);
        OnlineClass room = classRepository.save(OnlineClass.forStudent(teacher, "old-resume",
                "old-resume", "Maths", old, old.plusSeconds(3600), student));
        room.start(old);
        room.setTranscriptionState(ClassFeatureState.ACTIVE);
        room.setTranscriptionDispatchId("dispatch-before-leave");
        classRepository.saveAndFlush(room);
        participantRepository.save(OnlineClassParticipant.host(room, teacher));
        service.connect(teacherPrincipal, room.getId(), "before-drop");
        transcriptService.ingest(room.getId(), new TranscriptSegmentRequest("saved-before-leave",
                ParticipantIdentity.of(teacher.getId(), "before-drop"), "Teacher", "de", 0, 500,
                "Saved before leaving", 0.9));
        service.leave(teacherPrincipal, room.getId());
        observeEmptySince(room.getId(), NOW.minusSeconds(61));
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of());
        service.reconcileIdleSession(room.getId());
        assertThat(service.get(teacherPrincipal, room.getId()).status()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(service.get(teacherPrincipal, room.getId()).mediaState()).isEqualTo("IDLE");

        service.start(teacherPrincipal, room.getId());
        assertThat(service.connect(teacherPrincipal, room.getId(), "after-drop").token()).isNotBlank();
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of(
                ParticipantIdentity.of(teacher.getId(), "after-drop")));
        transcriptService.start(teacherPrincipal, room.getId(), List.of("de"));
        transcriptService.ingest(room.getId(), new TranscriptSegmentRequest("saved-after-return",
                ParticipantIdentity.of(teacher.getId(), "after-drop"), "Teacher", "de", 2000, 2500,
                "Added after returning", 0.9));

        OnlineClass saved = classRepository.findById(room.getId()).orElseThrow();
        assertThat(saved.getActualStartAt()).isEqualTo(old);
        assertThat(saved.getActualEndAt()).isNull();
        assertThat(classRepository.count()).isEqualTo(1);
        assertThat(transcriptService.segments(teacherPrincipal, room.getId()))
                .extracting(TranscriptSegmentResponse::text)
                .containsExactly("Saved before leaving", "Added after returning");
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "old-resume").orElseThrow()
                .getTranscriptTextForDisplay()).contains("Saved before leaving", "Added after returning");
        verify(transcriptionProvider).startTranscription(org.mockito.ArgumentMatchers.eq(room.getRoomName()),
                org.mockito.ArgumentMatchers.eq(room.getId().toString()), any(), org.mockito.ArgumentMatchers.eq(old));
        service.end(teacherPrincipal, room.getId());
        assertThat(service.get(teacherPrincipal, room.getId()).status()).isEqualTo(OnlineClassStatus.ENDED);
        assertThatThrownBy(() -> service.connect(teacherPrincipal, room.getId(), "closed"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("not open");
        assertThat(segmentRepository.count()).isEqualTo(2);
    }

    @Test
    void mediaProviderFailureDoesNotEndAnActiveRoomBeforeMonday() {
        OnlineClass room = materialize(); service.start(teacherPrincipal, room.getId());
        room = classRepository.findById(room.getId()).orElseThrow();
        when(mediaProvider.listParticipantIdentities(anyString())).thenThrow(new MediaProviderException("unavailable"));
        service.reconcileIdleSession(room.getId());
        assertThat(classRepository.findById(room.getId()).orElseThrow().getStatus()).isEqualTo(OnlineClassStatus.LIVE);
    }

    @Test
    void endIsFinalEvenIfMediaTeardownNeedsARetry() {
        OnlineClass room = materialize(); service.start(teacherPrincipal, room.getId());
        doThrow(new MediaProviderException("unavailable")).when(mediaProvider).closeRoom(anyString());
        service.end(teacherPrincipal, room.getId());
        assertThat(classRepository.findById(room.getId()).orElseThrow().isMediaClosePending()).isTrue();
        assertThat(service.get(studentPrincipal, room.getId()).entryState()).isEqualTo("ENDED");
        org.mockito.Mockito.doNothing().when(mediaProvider).closeRoom(anyString());
        service.reconcileIdleSession(room.getId());
        assertThat(classRepository.findById(room.getId()).orElseThrow().isMediaClosePending()).isFalse();
    }

}
