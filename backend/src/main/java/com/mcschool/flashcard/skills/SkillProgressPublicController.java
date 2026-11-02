package com.mcschool.flashcard.skills;

import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/public/skill-progress")
public class SkillProgressPublicController {

    private final SkillProgressShareService shares;

    public SkillProgressPublicController(SkillProgressShareService shares) {
        this.shares = shares;
    }

    @GetMapping
    public ResponseEntity<SkillProgressShareService.PublicProgress> read(@RequestParam String token) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.REFERRER_POLICY, "no-referrer")
                .header("X-Robots-Tag", "noindex, noarchive, nosnippet")
                .header("X-Content-Type-Options", "nosniff")
                .body(shares.read(token));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> error(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode())
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.REFERRER_POLICY, "no-referrer")
                .body(Map.of(
                        "status", e.getStatusCode().value(),
                        "message", e.getReason() == null ? "Ссылка на прогресс недействительна" : e.getReason()));
    }
}
