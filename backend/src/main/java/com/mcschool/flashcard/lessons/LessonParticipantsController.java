package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** An occurrence roster only. Never changes the permanent group or calendar series. */
@RestController
@RequestMapping("/api/v1/lessons")
@PreAuthorize("hasRole('TEACHER')")
public class LessonParticipantsController {
    private final LessonParticipantsService service;

    public LessonParticipantsController(LessonParticipantsService service) {
        this.service = service;
    }

    public record AddRequest(UUID studentId) {}
    public record TransferRequest(String sourceEventId, String targetEventId, UUID studentId) {}

    @GetMapping("/{eventId}/participants")
    public List<LessonParticipantsService.Participant> list(
            @AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable String eventId) {
        return service.list(teacher, eventId);
    }

    @PostMapping("/{eventId}/participants")
    public List<LessonParticipantsService.Participant> add(
            @AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable String eventId,
            @RequestBody AddRequest request) {
        return service.add(teacher, eventId, request.studentId());
    }

    @DeleteMapping("/{eventId}/participants/{studentId}")
    public List<LessonParticipantsService.Participant> remove(
            @AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable String eventId,
            @PathVariable UUID studentId) {
        return service.remove(teacher, eventId, studentId);
    }

    @PostMapping("/transfer-participant")
    @org.springframework.web.bind.annotation.ResponseStatus(HttpStatus.NO_CONTENT)
    public void transfer(@AuthenticationPrincipal AuthenticatedUser teacher,
                         @RequestBody TransferRequest request) {
        service.transfer(teacher, request.sourceEventId(), request.targetEventId(), request.studentId());
    }
}
