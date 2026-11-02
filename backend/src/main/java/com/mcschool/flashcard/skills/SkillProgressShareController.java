package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/skill-boards")
@PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
public class SkillProgressShareController {

    private final SkillProgressShareService shares;

    public SkillProgressShareController(SkillProgressShareService shares) {
        this.shares = shares;
    }

    @PostMapping("/{boardId}/students/{studentId}/parent-share")
    public SkillProgressShareService.ShareToken enable(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return shares.enable(boardId, studentId, caller);
    }

    @DeleteMapping("/{boardId}/students/{studentId}/parent-share")
    public ResponseEntity<Void> revoke(
            @PathVariable String boardId,
            @PathVariable UUID studentId,
            @AuthenticationPrincipal AuthenticatedUser caller) {
        shares.revoke(boardId, studentId, caller);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> error(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of(
                "status", e.getStatusCode().value(),
                "message", e.getReason() == null ? "Ошибка ссылки прогресса" : e.getReason()));
    }
}
