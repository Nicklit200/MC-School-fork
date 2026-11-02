package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** A real migrated database and provider identities: discovery, waiting room and token agree. */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.livekit-url=wss://test.invalid",
        "app.online-classes.livekit-api-key=test-key",
        "app.online-classes.livekit-api-secret=test-secret"
})
@Import(TeacherPresentLessonEntryIntegrationTest.FixedClock.class)
class TeacherPresentLessonEntryIntegrationTest extends AbstractIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-11-02T15:00:00Z");
    private static final Instant TOMORROW = Instant.parse("2026-11-03T15:00:00Z");

    @TestConfiguration
    static class FixedClock {
        @Bean @Primary Clock teacherPresenceTestClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }

    @Autowired private OnlineClassService service;
    @Autowired private OnlineClassAdmissionService admission;
    @Autowired private OnlineClassRepository classes;
    @Autowired private OnlineClassParticipantRepository participants;
    @Autowired private UserRepository users;
    @MockitoBean private LiveClassMediaProvider media;
    private User teacher;
    private User pupil;
    private AuthenticatedUser host;
    private AuthenticatedUser student;

    @BeforeEach
    void setup() {
        teacher = users.saveAndFlush(User.activeTeacher("Teacher", "presence@teacher.test", "presence-teacher", "unused"));
        pupil = users.saveAndFlush(User.managedStudent("Mark", teacher));
        host = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        student = new AuthenticatedUser(pupil.getId(), null, Role.STUDENT);
        when(media.isConfigured()).thenReturn(true);
        when(media.createConnection(anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(call -> new ParticipantConnection("wss://test.invalid", "token", call.getArgument(1),
                        call.getArgument(0), NOW.plus(Duration.ofMinutes(10))));
    }

    private OnlineClass opened(Instant scheduledStart) {
        var room = classes.saveAndFlush(OnlineClass.forStudent(teacher, "presence-" + scheduledStart,
                "presence", "Math", scheduledStart, scheduledStart.plusSeconds(3600), pupil));
        when(media.listParticipantIdentities(room.getRoomName())).thenReturn(List.of());
        service.start(host, room.getId());
        service.connect(host, room.getId(), "teacher-tab");
        // The provider sees the teacher now, but the joined webhook may be delayed.
        // Discovery must use the host connection only as a probe hint for stale emptySince.
        when(media.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(
                ParticipantIdentity.of(teacher.getId(), "teacher-tab")));
        return classes.findById(room.getId()).orElseThrow();
    }

    private void admit(OnlineClass room) {
        var request = admission.knock(student, room.getId());
        assertThat(request.state()).isEqualTo(JoinRequestState.PENDING);
        admission.approve(host, room.getId(), request.id());
    }

    @Test
    void teacherEnteringOnNovemberSecondOpensNovemberThirdLessonForFirstTimePupil() {
        var room = opened(TOMORROW);
        assertThat(room.getEmptySince()).isNotNull();
        var visible = service.get(student, room.getId());
        assertThat(visible.teacherPresent()).isTrue();
        assertThat(visible.joinWindowOpen()).isTrue();
        assertThat(visible.entryState()).isEqualTo("OPEN");
        assertThat(visible.entryDate().toString()).isEqualTo("2026-11-03");
        assertThat(service.listUpcoming(student)).extracting(OnlineClassResponse::id).contains(room.getId());
        admit(room);
        assertThat(service.connect(student, room.getId(), "mark-tab").token()).isEqualTo("token");
        assertThat(service.get(student, room.getId()).entryState()).isEqualTo("RECONNECT");
        verify(media).createConnection(eq(room.getRoomName()), eq(ParticipantIdentity.of(pupil.getId(), "mark-tab")),
                eq("Mark"), any(), eq(Duration.ofMinutes(10)));
    }

    @Test
    void newcomerDiscoversAndEntersAnExpiredWeekLessonWhenItsTeacherReturns() {
        var room = opened(NOW.minus(21, ChronoUnit.DAYS));
        assertThat(participants.findByOnlineClassIdAndUserId(room.getId(), pupil.getId())).isEmpty();
        assertThat(service.listUpcoming(student)).anySatisfy(response -> {
            assertThat(response.id()).isEqualTo(room.getId());
            assertThat(response.teacherPresent()).isTrue();
            assertThat(response.joinWindowOpen()).isTrue();
        });
        admit(room);
        assertThat(service.connect(student, room.getId(), "newcomer").token()).isEqualTo("token");
        verify(media).createConnection(eq(room.getRoomName()), eq(ParticipantIdentity.of(pupil.getId(), "newcomer")),
                eq("Mark"), any(), eq(Duration.ofMinutes(10)));
    }

    @Test
    void anotherPupilAgentOrAnotherTeacherCannotOpenAdmissionOrMintStudentToken() {
        var room = opened(TOMORROW);
        User otherTeacher = users.saveAndFlush(User.activeTeacher("Other", "other@presence.test", "other-presence", "unused"));
        when(media.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(
                ParticipantIdentity.of(pupil.getId(), "pupil-only"), "agent-transcriber",
                ParticipantIdentity.of(otherTeacher.getId(), "other-teacher")));
        var visible = service.get(student, room.getId());
        assertThat(visible.teacherPresent()).isFalse();
        assertThat(visible.joinWindowOpen()).isFalse();
        assertThat(visible.entryState()).isEqualTo("WAITING_FOR_TEACHER");
        assertThatThrownBy(() -> admission.knock(student, room.getId())).isInstanceOf(ConflictException.class);
        ClassTestSupport.admit(participants, room, pupil);
        assertThatThrownBy(() -> service.connect(student, room.getId(), "blocked"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("teacher");
        assertThatThrownBy(() -> service.get(new AuthenticatedUser(otherTeacher.getId(), null, Role.TEACHER), room.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(media, never()).createConnection(eq(room.getRoomName()), eq(ParticipantIdentity.of(pupil.getId(), "blocked")), anyString(), any(), any());
    }

    @Test
    void tokenAndAdmissionRecheckPresenceAfterCachedDiscoveryGrant() {
        var room = opened(TOMORROW);
        assertThat(service.get(student, room.getId()).teacherPresent()).isTrue();
        admit(room);
        when(media.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(ParticipantIdentity.of(pupil.getId(), "alone")));
        assertThatThrownBy(() -> service.connect(student, room.getId(), "fresh-check"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("teacher");
        assertThatThrownBy(() -> admission.knock(student, room.getId())).isInstanceOf(ConflictException.class);
        when(media.listParticipantIdentities(room.getRoomName())).thenThrow(new MediaProviderException("Provider unavailable"));
        assertThatThrownBy(() -> service.connect(student, room.getId(), "unknown-presence"))
                .isInstanceOf(ConflictException.class).hasMessageContaining("verified");
        assertThatThrownBy(() -> admission.knock(student, room.getId())).isInstanceOf(ConflictException.class);
    }

    @Test
    void removedAndTerminalRoomsStayClosedEvenWhileTheTeacherIsPresent() {
        var room = opened(TOMORROW);
        admit(room);
        var participant = participants.findByOnlineClassIdAndUserId(room.getId(), pupil.getId()).orElseThrow();
        participant.remove();
        participants.saveAndFlush(participant);
        assertThat(service.get(student, room.getId()).entryState()).isEqualTo("CLOSED");
        assertThat(service.get(student, room.getId()).joinWindowOpen()).isFalse();
        assertThatThrownBy(() -> service.connect(student, room.getId(), "removed")).isInstanceOf(ConflictException.class);
        service.end(host, room.getId());
        assertThat(service.get(student, room.getId()).entryState()).isEqualTo("ENDED");
        assertThat(service.get(student, room.getId()).teacherPresent()).isFalse();
    }
}
