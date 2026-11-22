package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only pupil-aware month mapping; same audience as the skills board. */
@RestController
@RequestMapping("/api/v1/skill-boards")
@PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
public class StudentMonthlyCurriculumController {
    private final StudentMonthlyCurriculumService service;

    public StudentMonthlyCurriculumController(StudentMonthlyCurriculumService service) {
        this.service = service;
    }

    @GetMapping("/{boardId}/students/{studentId}/monthly-curricula")
    public StudentMonthlyCurriculumService.YearEntry year(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @RequestParam int schoolYearStart,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.year(boardId, studentId, schoolYearStart, caller);
    }
}
