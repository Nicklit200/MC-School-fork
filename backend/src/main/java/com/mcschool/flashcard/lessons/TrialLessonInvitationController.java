package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class TrialLessonInvitationController {
    private final TrialLessonInvitationService invitations;
    public TrialLessonInvitationController(TrialLessonInvitationService invitations) {
        this.invitations = invitations;
    }
    public record NameRequest(@NotBlank @Size(min=2,max=80) String name) {}

    @GetMapping("/api/v1/trial-invitations")
    @PreAuthorize("hasRole('TEACHER')")
    public ResponseEntity<java.util.List<String>> listMine(
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(invitations.listMine(caller));
    }

    @PostMapping("/api/v1/trial-invitations/{eventId}")
    @PreAuthorize("hasRole('TEACHER')")
    public ResponseEntity<TrialLessonInvitationService.Created> issue(
            @AuthenticationPrincipal AuthenticatedUser caller, @PathVariable String eventId) {
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(invitations.issue(caller, eventId));
    }

    @DeleteMapping("/api/v1/trial-invitations/{eventId}")
    @PreAuthorize("hasRole('TEACHER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@AuthenticationPrincipal AuthenticatedUser caller, @PathVariable String eventId) {
        invitations.revoke(caller, eventId);
    }

    @GetMapping("/api/v1/public/trial-invitations/{token}")
    public ResponseEntity<TrialLessonInvitationService.InvitationInfo> info(@PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(invitations.info(token));
    }

    @PostMapping("/api/v1/public/trial-invitations/{token}/join")
    public ResponseEntity<TrialLessonInvitationService.Joined> join(
            @PathVariable String token, @Valid @RequestBody NameRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(invitations.claim(token, request.name()));
    }
}
