package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/skill-boards")
@PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
public class SkillBoardController {
    private final SkillBoardService service;
    public SkillBoardController(SkillBoardService service) { this.service=service; }
    @GetMapping("/{id}")
    public SkillBoardService.Snapshot get(@PathVariable String id) { return service.get(id); }
    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public SkillBoardService.Snapshot save(@PathVariable String id,
            @RequestBody SkillBoardService.SaveRequest request,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return service.save(id, request, caller.id());
    }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,Object>> error(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of(
            "status", e.getStatusCode().value(),
            "message", e.getReason()==null ? "Ошибка карты навыков" : e.getReason(),
            "errorCode", e.getStatusCode().value()==409 ? "REVISION_CONFLICT" : "INVALID_SKILL_BOARD"));
    }
}
