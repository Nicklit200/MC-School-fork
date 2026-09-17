package com.mcschool.flashcard.staging;

import com.mcschool.flashcard.auth.AuthService;
import com.mcschool.flashcard.auth.dto.AuthResponse;
import com.mcschool.flashcard.auth.dto.LoginRequest;
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
 * <p>This controller is also used to force a clean staging rebuild after auth configuration changes.</p>
 */
@RestController
@RequestMapping("/api/v1/auth")
public class StagingAuthController {

    private final AuthService authService;
    private final boolean enabled;
    private final String teacherPassword;
    private final String studentPassword;

    public StagingAuthController(
            AuthService authService,
            @Value("${STAGING_FIXTURES_ENABLED:false}") boolean enabled,
            @Value("${STAGING_TEACHER_PASSWORD:}") String teacherPassword,
            @Value("${STAGING_STUDENT_PASSWORD:}") String studentPassword) {
        this.authService = authService;
        this.enabled = enabled;
        this.teacherPassword = teacherPassword;
        this.studentPassword = studentPassword;
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
            case "teacher" -> authService.login(new LoginRequest(
                    StagingFixturesInitializer.TEACHER_EMAIL,
                    requireConfiguredPassword(teacherPassword)));
            case "student" -> authService.login(new LoginRequest(
                    StagingFixturesInitializer.STUDENT_USERNAME,
                    requireConfiguredPassword(studentPassword)));
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown staging profile");
        };
    }

    private void ensureEnabled() {
        if (!enabled) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private static String requireConfiguredPassword(String password) {
        if (password == null || password.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Staging account is not configured");
        }
        return password;
    }

    public record StagingLoginRequest(String profile) {}

    public record StagingProfileResponse(String id, String name, String role) {}
}
