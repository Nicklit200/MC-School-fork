package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.users.Role;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Listening layout only. Recording/transcription continue receiving the whole lesson. */
@Service
public class OnlineClassAudioFocusService {
    public record Request(UUID studentId, boolean announceAll) {}
    public record Focus(int version, UUID classId, UUID teacherId, UUID studentId, boolean announceAll) {}

    private final OnlineClassAccessService access;
    private final LiveClassMediaProvider media;

    public OnlineClassAudioFocusService(OnlineClassAccessService access, LiveClassMediaProvider media) {
        this.access = access;
        this.media = media;
    }

    @Transactional
    public Focus update(AuthenticatedUser caller, UUID classId, Request request) {
        if (request == null) throw new IllegalArgumentException("Audio focus request is required");
        // Serializes concurrent tabs and End with the provider metadata update.
        var lesson = access.requireHostForUpdate(caller, classId);
        if (lesson.getStatus() != OnlineClassStatus.LIVE && lesson.getStatus() != OnlineClassStatus.LOBBY_OPEN) {
            throw new ConflictException("The lesson is not running");
        }
        if (!media.isConfigured()) throw new ConflictException("Audio focus is unavailable");
        if (request.studentId() == null && request.announceAll()) {
            throw new IllegalArgumentException("An announcement requires a selected student");
        }
        if (request.studentId() != null) {
            access.requireAdmitted(new AuthenticatedUser(request.studentId(), null, Role.STUDENT), classId);
        }
        var focus = new Focus(1, classId, lesson.getTeacher().getId(), request.studentId(), request.announceAll());
        media.updateRoomAudioFocus(lesson.getRoomName(), new tools.jackson.databind.ObjectMapper().writeValueAsString(focus));
        return focus;
    }
}
