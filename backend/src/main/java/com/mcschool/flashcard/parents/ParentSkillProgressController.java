package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Private, parent-only progress. Authorization is checked against the actual parent-child relationship. */
@RestController
@RequestMapping("/api/v1/parent/children/{studentId}/skills")
@PreAuthorize("hasRole('PARENT')")
public class ParentSkillProgressController {
    private final ParentSkillProgressService service;
    public ParentSkillProgressController(ParentSkillProgressService service) {
        this.service = service;
    }

    /** The tree is the exact same curriculum graph used by the teacher dashboard. */
    @GetMapping("/tree")
    public ParentSkillProgressService.TreeSnapshot tree(
            @AuthenticationPrincipal AuthenticatedUser parent,
            @PathVariable UUID studentId) {
        return service.tree(parent, studentId);
    }

    @GetMapping
    public ParentSkillProgressService.Dashboard get(
            @AuthenticationPrincipal AuthenticatedUser parent,
            @PathVariable UUID studentId) {
        return service.get(parent, studentId);
    }
}
