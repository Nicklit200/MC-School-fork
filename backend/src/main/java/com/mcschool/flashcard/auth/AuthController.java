package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.auth.dto.ActivateAccountRequest;
import com.mcschool.flashcard.auth.dto.AuthResponse;
import com.mcschool.flashcard.auth.dto.LoginRequest;
import com.mcschool.flashcard.users.UserResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/activate")
    public AuthResponse activateAccount(@Valid @RequestBody ActivateAccountRequest request) {
        return authService.activateAccount(request);
    }

    @GetMapping("/me")
    public UserResponse currentUser(@AuthenticationPrincipal AuthenticatedUser caller) {
        return authService.currentUser(caller);
    }

    /**
     * Gives a school administrator a temporary teacher JWT without knowing or
     * changing the teacher's password. The frontend keeps the original admin
     * JWT separately so the administrator can return in one click.
     */
    @PostMapping("/impersonate/teacher/{teacherId}")
    @PreAuthorize("hasRole('ADMIN')")
    public AuthResponse impersonateTeacher(@PathVariable UUID teacherId) {
        return authService.impersonateTeacher(teacherId);
    }
}
