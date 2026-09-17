package com.mcschool.flashcard.staging;

import com.mcschool.flashcard.auth.AuthService;
import com.mcschool.flashcard.auth.dto.AuthResponse;
import com.mcschool.flashcard.users.Role;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Passwordless shortcuts for disposable staging accounts.
 *
 * <p>The endpoints deliberately return 404 unless staging fixtures are enabled,
 * so the same code is harmless if it is ever present in a non-staging build.</p>
 */
@RestController
@RequestMapping("/api/v1/auth")
public class StagingAuthController {

    private final AuthService authService;
    private final boolean enabled;

    public StagingAuthController(
            AuthService authService,
            @Value("${STAGING_FIXTURES_ENABLED:false}") boolean enabled) {
        this.authService = authService;
        this.enabled = enabled;
    }

    @GetMapping("/staging-profiles")
    public List<StagingProfileResponse> profiles() {
        ensureEnabled();
        return List.of(
                new StagingProfileResponse("teacher", "Test Teacher", "TEACHER"),
                new StagingProfileResponse("student", "Test Student", "STUDENT"));
    }

    @PostMapping("/staging-login")
    public AuthResponse login(@RequestBody StagingLoginRequest request) {
        ensureEnabled();
        if (request == null || request.profile() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown staging profile");
        }

        return switch (request.profile().trim().toLowerCase(Locale.ROOT)) {
            case "teacher" -> authService.stagingLogin(
                    StagingFixturesInitializer.TEACHER_EMAIL,
                    Role.TEACHER);
            case "student" -> authService.stagingLogin(
                    StagingFixturesInitializer.STUDENT_USERNAME,
                    Role.STUDENT);
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown staging profile");
        };
    }

    private void ensureEnabled() {
        if (!enabled) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    public record StagingLoginRequest(String profile) {}

    public record StagingProfileResponse(String id, String name, String role) {}
}
