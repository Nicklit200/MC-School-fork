package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/lesson-preparations")
@PreAuthorize("hasRole('TEACHER')")
public class LessonTranscriptController {
    private final LessonTranscriptReadService service;

    public LessonTranscriptController(LessonTranscriptReadService service) { this.service = service; }

    @GetMapping("/{eventId}/transcript-text")
    public LessonTranscriptReadService.Transcript get(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable @Size(min = 1, max = 255) String eventId,
            @RequestParam(defaultValue = "automatic") LessonTranscriptReadService.Source source,
            @RequestParam(defaultValue = "0") @Min(0) int offset,
            @RequestParam(defaultValue = "12000") @Min(1) @Max(20000) int limit,
            @RequestParam(required = false) @Size(min = 64, max = 64) String expectedRevision) {
        return service.get(teacher, eventId, source, offset, limit, expectedRevision);
    }
}
