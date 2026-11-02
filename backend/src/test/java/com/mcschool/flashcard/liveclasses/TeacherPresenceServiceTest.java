package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TeacherPresenceServiceTest {
    private static final Instant NOW = Instant.parse("2026-11-02T12:00:00Z");
    private final LiveClassMediaProvider provider = mock(LiveClassMediaProvider.class);
    private final MutableClock clock = new MutableClock(NOW);
    private final TeacherPresenceService service = new TeacherPresenceService(provider, clock);
    private User teacher;
    private UUID teacherId;
    private OnlineClass room;

    @BeforeEach
    void fixtures() {
        teacher = mock(User.class);
        teacherId = UUID.randomUUID();
        when(teacher.getId()).thenReturn(teacherId);
        room = room("lesson");
        room.start(NOW);
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void currentAlwaysQueriesProviderAndDoesNotTrustThePreviousAnswer() {
        when(provider.listParticipantIdentities(room.getRoomName()))
                .thenReturn(List.of(teacherIdentity()), List.of());
        assertThat(service.current(room)).isTrue();
        assertThat(service.current(room)).isFalse();
        verify(provider, times(2)).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void currentRequiresTheExactOwningTeacherIdentity() {
        UUID anotherTeacher = UUID.randomUUID();
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(Arrays.asList(
                ParticipantIdentity.of(anotherTeacher, "host"),
                "teacher:" + teacherId + "|tab",
                teacherId + "0|tab", "phone-camera:" + teacherId, null));
        assertThat(service.current(room)).isFalse();
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(
                ParticipantIdentity.of(anotherTeacher, "other"), teacherIdentity()));
        assertThat(service.current(room)).isTrue();
    }

    @Test
    void staleEmptyRoomMarkerDoesNotPreventAFreshTokenTimePresenceCheck() {
        room.observeEmpty(NOW.minusSeconds(30));
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(teacherIdentity()));
        assertThat(service.current(room)).isTrue();
        verify(provider).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void discoveryCachesOnlyBrieflyAndChecksProviderAgainAfterThreeSeconds() {
        when(provider.listParticipantIdentities(room.getRoomName()))
                .thenReturn(List.of(teacherIdentity()), List.of());
        assertThat(service.discovery(room)).isTrue();
        clock.advance(Duration.ofMillis(2999));
        assertThat(service.discovery(room)).isTrue();
        verify(provider).listParticipantIdentities(room.getRoomName());
        clock.advance(Duration.ofMillis(2));
        assertThat(service.discovery(room)).isFalse();
        verify(provider, times(2)).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void tokenTimeCheckIgnoresCachedDiscoveryPresence() {
        when(provider.listParticipantIdentities(room.getRoomName()))
                .thenReturn(List.of(teacherIdentity()), List.of());
        assertThat(service.discovery(room)).isTrue();
        assertThat(service.current(room)).isFalse();
        verify(provider, times(2)).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void discoveryNeverUsesCachedPresenceForAnObservedEmptyRoom() {
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(teacherIdentity()));
        assertThat(service.discovery(room)).isTrue();
        room.observeEmpty(NOW);
        assertThat(service.discovery(room)).isFalse();
        verify(provider).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void connectedHostHintAllowsAStaleEmptyMarkerToBeCheckedAgainstRealProviderPresence() {
        room.observeEmpty(NOW.minusSeconds(30));
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(teacherIdentity()));
        assertThat(service.discovery(room, true)).isTrue();
        verify(provider).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void connectedHostHintAloneCannotProveTeacherPresence() {
        room.observeEmpty(NOW.minusSeconds(30));
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of());
        assertThat(service.discovery(room, true)).isFalse();
        verify(provider).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void nonConnectableAndTerminalRoomsDoNotQueryTheProvider() {
        OnlineClass scheduled = room("scheduled");
        OnlineClass ended = room("ended"); ended.start(NOW); ended.end(NOW.plusSeconds(1));
        OnlineClass cancelled = room("cancelled"); cancelled.cancel();
        for (OnlineClass unavailable : List.of(scheduled, ended, cancelled)) {
            assertThat(service.current(unavailable)).isFalse();
            assertThat(service.discovery(unavailable)).isFalse();
        }
        verify(provider, never()).listParticipantIdentities(anyString());
    }

    @Test
    void discoveryCachesPerClassAndDoesNotConfuseTheSameTeachersDifferentLessons() {
        OnlineClass anotherRoom = room("another-lesson"); anotherRoom.start(NOW);
        when(provider.listParticipantIdentities(room.getRoomName())).thenReturn(List.of(teacherIdentity()));
        when(provider.listParticipantIdentities(anotherRoom.getRoomName())).thenReturn(List.of());
        assertThat(service.discovery(room)).isTrue();
        assertThat(service.discovery(anotherRoom)).isFalse();
        verify(provider).listParticipantIdentities(room.getRoomName());
        verify(provider).listParticipantIdentities(anotherRoom.getRoomName());
    }

    @Test
    void providerErrorsFailClosedAndCurrentCanRecoverOnItsNextFreshCheck() {
        when(provider.listParticipantIdentities(room.getRoomName()))
                .thenThrow(new MediaProviderException("Provider is unavailable"))
                .thenReturn(List.of(teacherIdentity()));
        assertThat(service.current(room)).isFalse();
        assertThat(service.current(room)).isTrue();
        verify(provider, times(2)).listParticipantIdentities(room.getRoomName());
    }

    @Test
    void discoveryErrorsFailClosedWithoutBreakingCalendarListing() {
        when(provider.listParticipantIdentities(room.getRoomName()))
                .thenThrow(new MediaProviderException("Provider is unavailable"));
        assertThat(service.discovery(room)).isFalse();
    }

    private OnlineClass room(String eventId) {
        return OnlineClass.forStudent(teacher, eventId, eventId, "Maths", NOW, NOW.plusSeconds(3600), mock(User.class));
    }

    private String teacherIdentity() { return ParticipantIdentity.of(teacherId, "teacher-tab"); }

    private static final class MutableClock extends Clock {
        private Instant current;
        private MutableClock(Instant initial) { current = initial; }
        private void advance(Duration elapsed) { current = current.plus(elapsed); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return current; }
    }
}
