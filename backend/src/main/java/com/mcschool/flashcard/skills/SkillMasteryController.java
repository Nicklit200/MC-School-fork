package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/skill-boards")
@PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
public class SkillMasteryController {
    private final SkillMasteryService service;

    public SkillMasteryController(SkillMasteryService service) {
        this.service = service;
    }

    @GetMapping("/{boardId}/students")
    public List<SkillMasteryService.StudentOption> students(
            @PathVariable String boardId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.listStudents(caller);
    }

    @GetMapping("/{boardId}/students/{studentId}/mastery")
    public SkillMasteryService.MasterySnapshot mastery(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.get(boardId, studentId, caller);
    }

    @PutMapping("/{boardId}/students/{studentId}/mastery/{skillId}")
    public SkillMasteryService.MasterySnapshot update(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @PathVariable String skillId,
            @RequestBody SkillMasteryService.UpdateRequest request,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        if (request == null) throw new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST, "Укажите процент");
        return service.update(boardId, studentId, skillId, request.mastery(), caller);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,Object>> error(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of(
                "status", e.getStatusCode().value(),
                "message", e.getReason() == null ? "Ошибка прогресса навыков" : e.getReason()));
    }
}
