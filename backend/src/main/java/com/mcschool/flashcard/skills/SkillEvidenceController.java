package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Read-only proof list in /skills; all writes go through the MCH3 connector. */
@RestController
@RequestMapping("/api/v1/skill-boards")
@PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
public class SkillEvidenceController {
    private final SkillEvidenceService service;
    public SkillEvidenceController(SkillEvidenceService service) {this.service=service;}

    /** Writes are authenticated and require a real, explicit evidence observation.
     * MCH3's execute_site_function also delegates here, with its own audit receipt.
     */
    @PostMapping("/{boardId}/students/{studentId}/evidence")
    public SkillEvidenceService.Recorded record(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @RequestBody SkillEvidenceService.Observation body,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.record(boardId,studentId,body,caller);
    }

    @GetMapping("/{boardId}/students/{studentId}/evidence")
    public List<SkillEvidenceService.Evidence> evidence(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.list(boardId,studentId,caller);
    }
}
