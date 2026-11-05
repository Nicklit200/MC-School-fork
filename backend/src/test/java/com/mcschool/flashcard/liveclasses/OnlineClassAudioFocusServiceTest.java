package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.MediaProviderException;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OnlineClassAudioFocusServiceTest {
    private final UUID classId = UUID.randomUUID(), teacherId = UUID.randomUUID(), studentId = UUID.randomUUID();
    private final AuthenticatedUser teacher = new AuthenticatedUser(teacherId, null, Role.TEACHER);
    private final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    private final LiveClassMediaProvider media = mock(LiveClassMediaProvider.class);
    private final OnlineClass lesson = mock(OnlineClass.class);
    private final OnlineClassAudioFocusService service = new OnlineClassAudioFocusService(access, media);

    @BeforeEach
    void setup() {
        var owner = mock(User.class);
        when(owner.getId()).thenReturn(teacherId);
        when(lesson.getTeacher()).thenReturn(owner);
        when(lesson.getRoomName()).thenReturn("test-audio-room");
        when(lesson.getStatus()).thenReturn(OnlineClassStatus.LIVE);
        when(access.requireHostForUpdate(teacher, classId)).thenReturn(lesson);
        when(media.isConfigured()).thenReturn(true);
    }

    @Test
    void ownerCanFocusAnAdmittedPupilAndReturnToTheGroup() {
        var request = new OnlineClassAudioFocusService.Request(studentId, false);
        assertThat(service.update(teacher, classId, request).studentId()).isEqualTo(studentId);
        verify(access).requireAdmitted(new AuthenticatedUser(studentId, null, Role.STUDENT), classId);
        var json = ArgumentCaptor.forClass(String.class);
        verify(media).updateRoomAudioFocus(eq("test-audio-room"), json.capture());
        var value = new tools.jackson.databind.ObjectMapper().readTree(json.getValue());
        assertThat(value.path("classId").asText()).isEqualTo(classId.toString());
        assertThat(value.path("teacherId").asText()).isEqualTo(teacherId.toString());
        assertThat(service.update(teacher, classId, new OnlineClassAudioFocusService.Request(null, false)).studentId()).isNull();
    }

    @Test
    void announcementRetainsTheSelectedPupil() {
        var result = service.update(teacher, classId, new OnlineClassAudioFocusService.Request(studentId, true));
        assertThat(result.announceAll()).isTrue();
        assertThat(result.studentId()).isEqualTo(studentId);
    }

    @Test
    void refusedOwnerOrRemovedPupilCannotChangeRoomAudio() {
        when(access.requireHostForUpdate(teacher, classId)).thenThrow(new ResourceNotFoundException("not found"));
        assertThatThrownBy(() -> service.update(teacher, classId, new OnlineClassAudioFocusService.Request(studentId, false)))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(media);
    }

    @Test
    void outsidersAndNonAdmittedPupilsCannotBeSelected() {
        when(access.requireAdmitted(any(), eq(classId))).thenThrow(new ResourceNotFoundException("not found"));
        assertThatThrownBy(() -> service.update(teacher, classId, new OnlineClassAudioFocusService.Request(studentId, false)))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(media, never()).updateRoomAudioFocus(anyString(), anyString());
    }

    @Test
    void terminalLessonsAndMalformedAnnouncementsAreRejected() {
        assertThatThrownBy(() -> service.update(teacher, classId, new OnlineClassAudioFocusService.Request(null, true)))
                .isInstanceOf(IllegalArgumentException.class);
        when(lesson.getStatus()).thenReturn(OnlineClassStatus.ENDED);
        assertThatThrownBy(() -> service.update(teacher, classId, new OnlineClassAudioFocusService.Request(null, false)))
                .isInstanceOf(ConflictException.class);
        verify(media, never()).updateRoomAudioFocus(anyString(), anyString());
    }

    @Test
    void providerOutageIsReportedInsteadOfClaimingTheSwitchSucceeded() {
        doThrow(new MediaProviderException("offline")).when(media).updateRoomAudioFocus(anyString(), anyString());
        assertThatThrownBy(() -> service.update(teacher, classId, new OnlineClassAudioFocusService.Request(studentId, false)))
                .isInstanceOf(MediaProviderException.class);
    }
}
