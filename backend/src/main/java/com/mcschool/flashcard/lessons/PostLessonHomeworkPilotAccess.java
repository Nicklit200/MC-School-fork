package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Teacher-only post-lesson homework rollout. An exact teacher UUID enables the pilot;
 * the explicit value ALL enables every authenticated teacher. Unknown values fail closed.
 * The classroom owner is still checked for every request and background job.
 */
@Component
public class PostLessonHomeworkPilotAccess {
    private final UUID pilotTeacherId;
    private final boolean allTeachersEnabled;

    public PostLessonHomeworkPilotAccess(
            @Value("${POST_LESSON_HOMEWORK_PILOT_TEACHER_ID:}") String configuredId) {
        String setting = configuredId == null ? "" : configuredId.trim();
        this.allTeachersEnabled = "ALL".equalsIgnoreCase(setting);
        UUID parsed = null;
        if (!setting.isBlank() && !allTeachersEnabled) {
            try { parsed = UUID.fromString(setting); }
            catch (IllegalArgumentException ignored) { /* Invalid config fails closed. */ }
        }
        this.pilotTeacherId = parsed;
    }

    public UUID teacherId() { return pilotTeacherId; }

    public boolean allTeachersEnabled() { return allTeachersEnabled; }

    public boolean enabled() { return allTeachersEnabled || pilotTeacherId != null; }

    public boolean allowed(UUID userId) {
        return userId != null && (allTeachersEnabled || Objects.equals(pilotTeacherId,userId));
    }

    public void require(AuthenticatedUser user) {
        if(user == null || user.role() != Role.TEACHER || !allowed(user.id()))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Feature unavailable");
    }

    public void require(UUID userId) {
        if(!allowed(userId))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Feature unavailable");
    }
}
