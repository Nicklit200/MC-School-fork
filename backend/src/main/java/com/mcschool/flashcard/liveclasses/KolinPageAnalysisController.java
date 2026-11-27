package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Teacher-only page analysis, separate from chat and material generation. */
@RestController
@RequestMapping("/api/v1/online-classes/{classId}/kolin/page-analyses")
@PreAuthorize("hasRole('TEACHER')")
public class KolinPageAnalysisController {
    private final KolinPageAnalysisService service;
    public KolinPageAnalysisController(KolinPageAnalysisService service) { this.service=service; }

    @GetMapping("/enabled")
    public ResponseEntity<java.util.Map<String,Boolean>> enabled(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(
                java.util.Map.of("enabled",service.enabled(teacher,classId)));
    }

    @PostMapping
    public ResponseEntity<KolinPageAnalysisStore.Result> analyze(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId, @Valid @RequestBody KolinBoardReviewService.Snapshot snapshot) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.analyze(teacher,classId,snapshot));
    }

    /** Legacy background polling is disabled during the manual-check experiment. */
    @GetMapping("/candidates")
    public ResponseEntity<List<KolinPageAnalysisStore.Candidate>> candidates(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.candidates(teacher,classId));
    }

    @GetMapping("/manual-candidates")
    public ResponseEntity<List<KolinPageAnalysisStore.Candidate>> manualCandidates(
            @AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable UUID classId,
            @RequestParam UUID studentId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.manualCandidates(teacher,classId,studentId));
    }

    @GetMapping("/usage")
    public ResponseEntity<java.util.Map<String,Object>> usage(@AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.usage(teacher,classId));
    }

    @GetMapping
    public ResponseEntity<List<KolinPageAnalysisStore.SavedResult>> current(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId,@RequestParam UUID studentId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.current(teacher,classId,studentId));
    }

    @ExceptionHandler(KolinRequestException.class)
    public ResponseEntity<com.mcschool.flashcard.common.ApiErrorResponse> failure(
            KolinRequestException error,jakarta.servlet.http.HttpServletRequest request) {
        return ResponseEntity.status(error.getStatusCode()).body(com.mcschool.flashcard.common.ApiErrorResponse.of(
                error.getStatusCode().value(),error.getErrorCode(),error.getReason(),request.getRequestURI()));
    }
}
