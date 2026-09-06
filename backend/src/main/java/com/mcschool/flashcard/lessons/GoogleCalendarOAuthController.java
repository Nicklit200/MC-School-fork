package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GoogleCalendarConnectionResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/google-calendar")
public class GoogleCalendarOAuthController {

    private final GoogleCalendarOAuthService oauthService;

    public GoogleCalendarOAuthController(GoogleCalendarOAuthService oauthService) {
        this.oauthService = oauthService;
    }

    @GetMapping("/connection")
    @PreAuthorize("hasRole('TEACHER')")
    public GoogleCalendarConnectionResponse connection(@AuthenticationPrincipal AuthenticatedUser caller) {
        return oauthService.connection(caller);
    }

    @DeleteMapping("/connection")
    @PreAuthorize("hasRole('TEACHER')")
    public void disconnect(@AuthenticationPrincipal AuthenticatedUser caller) {
        oauthService.disconnect(caller);
    }

    @GetMapping("/oauth/callback")
    public void callback(@RequestParam(required = false) String state,
                         @RequestParam(required = false) String code,
                         @RequestParam(required = false) String error,
                         HttpServletResponse response) throws IOException {
        response.sendRedirect(oauthService.handleCallback(state, code, error));
    }
}
