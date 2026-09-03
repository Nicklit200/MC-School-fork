package com.mcschool.flashcard.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.dto.ActivateAccountRequest;
import com.mcschool.flashcard.auth.dto.AuthResponse;
import com.mcschool.flashcard.auth.dto.LoginRequest;
import com.mcschool.flashcard.common.InvalidInvitationException;
import com.mcschool.flashcard.config.JwtProperties;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private final UserRepository userRepository = mock(UserRepository.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final JwtService jwtService =
            new JwtService(new JwtProperties("test-secret-that-is-long-enough-for-hs256", 60));
    private final AuthService authService = new AuthService(userRepository, passwordEncoder, jwtService);

    @Test
    void loginReturnsTokenForCorrectCredentials() {
        User admin = User.bootstrapAdmin("Admin", "admin@test.local", passwordEncoder.encode("Secret123!"));
        when(userRepository.findByEmail("admin@test.local")).thenReturn(Optional.of(admin));

        AuthResponse response = authService.login(new LoginRequest("  Admin@Test.local ", "Secret123!"));

        assertThat(response.accessToken()).isNotBlank();
        assertThat(response.tokenType()).isEqualTo("Bearer");
        assertThat(response.user().email()).isEqualTo("admin@test.local");
    }

    @Test
    void loginFailsForUnknownEmail() {
        when(userRepository.findByEmail("nobody@test.local")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(new LoginRequest("nobody@test.local", "whatever")))
                .isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void loginFailsForWrongPassword() {
        User admin = User.bootstrapAdmin("Admin", "admin@test.local", passwordEncoder.encode("Secret123!"));
        when(userRepository.findByEmail("admin@test.local")).thenReturn(Optional.of(admin));

        assertThatThrownBy(() -> authService.login(new LoginRequest("admin@test.local", "wrong")))
                .isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void loginFailsForAccountThatHasNotAcceptedItsInvitation() {
        User invited = User.invitedTeacher("Teacher", "teacher@test.local", "token",
                Instant.now().plusSeconds(3600));
        when(userRepository.findByEmail("teacher@test.local")).thenReturn(Optional.of(invited));

        assertThatThrownBy(() -> authService.login(new LoginRequest("teacher@test.local", "anything")))
                .isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void activateSetsPasswordAndLogsTheUserIn() {
        User invited = User.invitedTeacher("Teacher", "teacher@test.local", "valid-token",
                Instant.now().plusSeconds(3600));
        when(userRepository.findByInvitationToken("valid-token")).thenReturn(Optional.of(invited));

        AuthResponse response = authService.activateAccount(
                new ActivateAccountRequest("valid-token", "teacher@test.local", "NewPassword1!"));

        assertThat(invited.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(invited.getInvitationToken()).isNull();
        assertThat(passwordEncoder.matches("NewPassword1!", invited.getPasswordHash())).isTrue();
        assertThat(response.accessToken()).isNotBlank();
    }

    @Test
    void activateStudentWithoutEmailStoresProvidedEmail() {
        User teacher = User.bootstrapAdmin("Owner", "owner@test.local", passwordEncoder.encode("Password1!"));
        User invited = User.invitedStudent("Student", null, teacher, "student-token",
                Instant.now().plusSeconds(3600));
        when(userRepository.findByInvitationToken("student-token")).thenReturn(Optional.of(invited));
        when(userRepository.existsByEmail("student@test.local")).thenReturn(false);

        authService.activateAccount(
                new ActivateAccountRequest("student-token", " Student@Test.Local ", "NewPassword1!"));

        assertThat(invited.getEmail()).isEqualTo("student@test.local");
        assertThat(invited.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }

    @Test
    void activateFailsForUnknownToken() {
        when(userRepository.findByInvitationToken("unknown")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.activateAccount(
                new ActivateAccountRequest("unknown", "nobody@test.local", "Password1!")))
                .isInstanceOf(InvalidInvitationException.class);
    }

    @Test
    void activateFailsForExpiredInvitation() {
        User invited = User.invitedTeacher("Teacher", "teacher@test.local", "expired-token",
                Instant.now().minusSeconds(60));
        when(userRepository.findByInvitationToken("expired-token")).thenReturn(Optional.of(invited));

        assertThatThrownBy(() -> authService.activateAccount(
                new ActivateAccountRequest("expired-token", "teacher@test.local", "Password1!")))
                .isInstanceOf(InvalidInvitationException.class)
                .hasMessageContaining("expired");
    }
}
