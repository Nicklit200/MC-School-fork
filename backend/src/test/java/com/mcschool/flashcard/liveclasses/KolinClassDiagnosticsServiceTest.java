package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class KolinClassDiagnosticsServiceTest {
    final User teacher = User.activeTeacher("Teacher","teacher@test.local","teacher","hash");
    final User mark = User.managedStudent("Марк",teacher);
    final User other = User.managedStudent("Outsider",teacher);
    final OnlineClass room = OnlineClass.forGroup(teacher,"event","binding","Math",
        Instant.now(),Instant.now().plusSeconds(3600),StudentGroup.create(teacher,"Group 1"));
    final AuthenticatedUser host = new AuthenticatedUser(teacher.getId(),teacher.getEmail(),Role.TEACHER);
    final AuthenticatedUser pupil = new AuthenticatedUser(mark.getId(),mark.getEmail(),Role.STUDENT);
    final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    final OnlineClassParticipantRepository participants = mock(OnlineClassParticipantRepository.class);
    final KolinTaskRoster roster = mock(KolinTaskRoster.class);
    final LiveClassMediaProvider media = mock(LiveClassMediaProvider.class);
    final KolinDiagnosticEventRepository events = mock(KolinDiagnosticEventRepository.class);
    final Clock clock = Clock.fixed(Instant.parse("2026-11-10T16:00:00Z"),ZoneOffset.UTC);
    final KolinClassDiagnosticsService service =
        new KolinClassDiagnosticsService(access,participants,roster,media,events,clock);

    void setup() {
        when(access.requireHost(host,room.getId())).thenReturn(room);
        when(roster.read(room)).thenReturn(List.of(new KolinTaskRoster.Pupil(mark.getId(),"Марк")));
        var joined = OnlineClassParticipant.student(room,mark);
        joined.admit();
        joined.markJoined(clock.instant().minusSeconds(20));
        var outsider = OnlineClassParticipant.student(room,other);
        when(participants.findAllByOnlineClassIdOrderByCreatedAtAsc(room.getId()))
            .thenReturn(List.of(joined,outsider));
        when(events.findTop30ByOnlineClassIdAndRecordedAtAfterOrderByRecordedAtDesc(any(),any()))
            .thenReturn(List.of());
    }

    @SuppressWarnings("unchecked")
    @Test void answersMicQuestionsFromObservedTracksButNeverClaimsWhoMutedThem() {
        setup();
        when(media.isConfigured()).thenReturn(true);
        when(media.listParticipantMedia(room.getRoomName())).thenReturn(List.of(
            new LiveClassMediaProvider.MediaParticipant(ParticipantIdentity.of(mark.getId(),"tablet"),true,true),
            new LiveClassMediaProvider.MediaParticipant(ParticipantIdentity.of(other.getId(),"elsewhere"),true,false)));
        var result = service.read(host,room,"Марк сам выключил микрофон?");
        assertThat(result).containsEntry("liveKitObservation","observed");
        var rows = (List<Map<String,Object>>) result.get("participants");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("name","Марк")
            .containsEntry("microphoneTrackStatus","muted")
            .containsEntry("microphonePermissionAllowed",true);
        assertThat(result.toString()).contains("NOT the student's device switch")
            .doesNotContain(other.getId().toString(),"Outsider","teacher@test.local");
    }

    @Test void providerFailureIsNotInterpretedAsMutedOrDisconnected() {
        setup();
        when(media.isConfigured()).thenReturn(true);
        when(media.listParticipantMedia(anyString())).thenThrow(new IllegalStateException("secret"));
        var result = service.read(host,room,"Нет звука, проблема сети?");
        assertThat(result).containsEntry("liveKitObservation","unavailable");
        assertThat(result.toString()).contains("not_checked").doesNotContain("secret");
    }

    @Test void savesOnlyAllowlistedClientErrorAndUsesServerTime() {
        when(access.requireAdmitted(pupil,room.getId())).thenReturn(room);
        service.report(pupil,room.getId(),"MEDIA_DEVICES");
        var captor = org.mockito.ArgumentCaptor.forClass(KolinDiagnosticEvent.class);
        verify(events).save(captor.capture());
        assertThat(captor.getValue().getUserId()).isEqualTo(mark.getId());
        assertThat(captor.getValue().getCategory()).isEqualTo("MEDIA_DEVICES");
        assertThat(captor.getValue().getRecordedAt()).isEqualTo(clock.instant());
        assertThatThrownBy(() -> service.report(pupil,room.getId(),"raw-error-token=abc"))
            .isInstanceOf(IllegalArgumentException.class);
        verify(events).deleteByRecordedAtBefore(clock.instant().minus(java.time.Duration.ofDays(7)));
    }

    @Test void deniesDiagnosticsForOtherTeachersOrOutsidersWithoutReadingMedia() {
        var outsider = new AuthenticatedUser(other.getId(),other.getEmail(),Role.STUDENT);
        when(access.requireHost(host,room.getId())).thenThrow(
            new com.mcschool.flashcard.common.ResourceNotFoundException("Unknown room"));
        assertThatThrownBy(()->service.read(host,room,"микрофон")).isInstanceOf(
            com.mcschool.flashcard.common.ResourceNotFoundException.class);
        when(access.requireAdmitted(outsider,room.getId())).thenThrow(
            new com.mcschool.flashcard.common.ResourceNotFoundException("Unknown room"));
        assertThatThrownBy(()->service.report(outsider,room.getId(),"MEDIA_DEVICES")).isInstanceOf(
            com.mcschool.flashcard.common.ResourceNotFoundException.class);
        verifyNoInteractions(media,events);
    }
}
