package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ai-pilot")
@PreAuthorize("hasRole('TEACHER')")
public class AiLessonPilotController {

    private final AiLessonPilotService service;

    public AiLessonPilotController(AiLessonPilotService service) {
        this.service = service;
    }

    @GetMapping("/status")
    public Map<String, Object> status(@AuthenticationPrincipal AuthenticatedUser caller) {
        return service.status(caller);
    }

    @GetMapping("/settings")
    public Map<String, Object> settings(@AuthenticationPrincipal AuthenticatedUser caller) {
        return service.scheduleSettings(caller);
    }

    @PutMapping("/settings")
    public Map<String, Object> updateSettings(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @RequestBody Map<String, Object> body) {
        boolean enabled = Boolean.parseBoolean(String.valueOf(body.getOrDefault("enabled", true)));
        String preparationTime = String.valueOf(body.getOrDefault("preparationTime", "10:00"));
        return service.updateScheduleSettings(caller, enabled, preparationTime);
    }

    @PostMapping("/lessons/{eventId}/prepare")
    public LessonPreparationResponse prepare(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String eventId) {
        return service.prepareLesson(caller, eventId);
    }

    @PostMapping("/lessons/{eventId}/analyze")
    public LessonPreparationResponse analyze(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String eventId) {
        return service.analyzeTranscript(caller, eventId);
    }
}
