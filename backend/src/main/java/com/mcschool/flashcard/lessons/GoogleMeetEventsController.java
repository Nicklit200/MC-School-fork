package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GoogleMeetEventStatusResponse;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/google-meet")
public class GoogleMeetEventsController {

    private final GoogleMeetEventsService eventsService;

    public GoogleMeetEventsController(GoogleMeetEventsService eventsService) {
        this.eventsService = eventsService;
    }

    @PostMapping("/subscription")
    @PreAuthorize("hasRole('TEACHER')")
    public GoogleMeetEventStatusResponse ensureSubscription(Authentication authentication) {
        return eventsService.ensureSubscription((AuthenticatedUser) authentication.getPrincipal());
    }

    @GetMapping("/status")
    @PreAuthorize("hasRole('TEACHER')")
    public GoogleMeetEventStatusResponse status(Authentication authentication) {
        return eventsService.status((AuthenticatedUser) authentication.getPrincipal());
    }

    @PostMapping("/events")
    public ResponseEntity<Void> receiveEvent(
            @RequestParam("token") String token,
            @RequestBody Map<String, Object> envelope) {
        eventsService.handlePubSub(token, envelope);
        return ResponseEntity.noContent().build();
    }
}
