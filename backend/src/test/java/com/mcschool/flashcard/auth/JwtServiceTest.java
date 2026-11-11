package com.mcschool.flashcard.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.config.JwtProperties;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private static final String SECRET = "test-secret-that-is-long-enough-for-hs256";

    private final JwtService jwtService = new JwtService(new JwtProperties(SECRET, 60));
    private final User admin = User.bootstrapAdmin("Admin", "admin@test.local", "hash");

    @Test
    void trialLinkRemainsStableForOneLessonAndDiffersBetweenLessons() {
        java.util.UUID teacher = java.util.UUID.randomUUID();
        java.util.UUID room = java.util.UUID.randomUUID();
        String first = jwtService.trialInvitationToken(teacher, "local-lesson-a", room);
        assertThat(first).hasSize(43);
        assertThat(jwtService.trialInvitationToken(teacher, "local-lesson-a", room)).isEqualTo(first);
        assertThat(jwtService.trialInvitationToken(teacher, "local-lesson-b", room)).isNotEqualTo(first);
        assertThat(jwtService.trialInvitationToken(java.util.UUID.randomUUID(), "local-lesson-a", room))
                .isNotEqualTo(first);
    }

    @Test
    void issuesTokenThatVerifiesToTheSameUser() {
        String token = jwtService.generateToken(admin);

        var claims = jwtService.verify(token);

        assertThat(claims).isPresent();
        assertThat(claims.get().userId()).isEqualTo(admin.getId());
        assertThat(claims.get().role()).isEqualTo(Role.ADMIN);
    }

    @Test
    void rejectsTamperedToken() {
        String token = jwtService.generateToken(admin);

        assertThat(jwtService.verify(token + "x")).isEmpty();
    }

    @Test
    void rejectsGarbageToken() {
        assertThat(jwtService.verify("not-a-jwt")).isEmpty();
    }

    @Test
    void rejectsExpiredToken() {
        JwtService expiredIssuer = new JwtService(new JwtProperties(SECRET, -5));

        String token = expiredIssuer.generateToken(admin);

        assertThat(expiredIssuer.verify(token)).isEmpty();
    }

    @Test
    void rejectsTokenSignedWithDifferentSecret() {
        JwtService other = new JwtService(new JwtProperties("another-secret-that-is-long-enough!!", 60));

        String token = other.generateToken(admin);

        assertThat(jwtService.verify(token)).isEmpty();
    }

    @Test
    void refusesToStartWithTooShortSecret() {
        assertThatThrownBy(() -> new JwtService(new JwtProperties("short", 60)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 characters");
    }

    @Test
    void refusesToStartWithTheInsecureDefaultWhenGuardIsOn() {
        JwtProperties insecure = new JwtProperties(JwtService.KNOWN_INSECURE_SECRET, 60);

        assertThatThrownBy(() -> new JwtService(insecure, true))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("insecure");
    }

    @Test
    void allowsTheInsecureDefaultForLocalDevWhenGuardIsOff() {
        JwtProperties insecure = new JwtProperties(JwtService.KNOWN_INSECURE_SECRET, 60);

        // Constructs (with a logged warning) so local development is not blocked.
        assertThat(new JwtService(insecure, false)).isNotNull();
    }
}
