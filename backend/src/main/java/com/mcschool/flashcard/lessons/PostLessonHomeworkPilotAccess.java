package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Temporary private pilot. Fail closed until one exact teacher UUID is configured.
 * A hidden button is never a security boundary: every endpoint and background worker
 * must enforce the same allowlist.
 */
@Component
public class PostLessonHomeworkPilotAccess {
    private final UUID pilotTeacherId;

    public PostLessonHomeworkPilotAccess(
            @Value("${POST_LESSON_HOMEWORK_PILOT_TEACHER_ID:}") String configuredId) {
        UUID parsed = null;
        if (configuredId != null && !configuredId.isBlank()) {
            try { parsed = UUID.fromString(configuredId.trim()); }
            catch (IllegalArgumentException ignored) { /* Invalid config fails closed. */ }
        }
        this.pilotTeacherId = parsed;
    }

    public UUID teacherId() { return pilotTeacherId; }

    public boolean allowed(UUID userId) {
        return pilotTeacherId != null && Objects.equals(pilotTeacherId,userId);
    }

    public void require(AuthenticatedUser user) {
        if(user == null || !allowed(user.id()))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Feature unavailable");
    }

    public void require(UUID userId) {
        if(!allowed(userId))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Feature unavailable");
    }
}
