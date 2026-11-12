package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.config.JwtProperties;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Issues and verifies the stateless HS256/384 access tokens used for API
 * authentication. The token carries only the user id and role; the
 * authentication filter re-loads the user from the database on every request,
 * so deleted accounts lose access immediately.
 */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    /**
     * The built-in development secret shipped in application.properties. It is
     * public (in the repo), so tokens signed with it are forgeable — it must never
     * be used in a real deployment.
     */
    static final String KNOWN_INSECURE_SECRET = "local-dev-only-jwt-secret-change-me-1234567890";

    /** What we trust from a verified token. */
    public record TokenClaims(UUID userId, Role role) {
    }

    private final SecretKey key;
    private final Duration expiration;

    @Autowired
    public JwtService(JwtProperties properties,
                      @Value("${app.security.jwt.fail-on-insecure-secret:false}") boolean failOnInsecureSecret) {
        String secret = properties.secret();
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException(
                    "app.security.jwt.secret (JWT_SECRET) must be at least 32 characters long");
        }
        if (isInsecure(secret)) {
            String message = "app.security.jwt.secret is set to the built-in insecure development value; "
                    + "set a strong random JWT_SECRET before exposing this service.";
            if (failOnInsecureSecret) {
                throw new IllegalStateException(message);
            }
            log.warn("SECURITY WARNING: {}", message);
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expiration = Duration.ofMinutes(properties.expirationMinutes());
    }

    /** Convenience constructor for tests (never fails on the insecure default). */
    JwtService(JwtProperties properties) {
        this(properties, false);
    }

    private static boolean isInsecure(String secret) {
        return secret.equals(KNOWN_INSECURE_SECRET)
                || secret.toLowerCase(Locale.ROOT).contains("change-me");
    }

    public String generateToken(User user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(user.getId().toString())
                .claim("role", user.getRole().name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expiration)))
                .signWith(key)
                .compact();
    }

    /**
     * Stable, unguessable 256-bit invitation capability. Re-issuing the
     * same trial produces the identical URL without persisting a plaintext
     * secret. Actual permission is still checked against the invitation row.
     */
    public String trialInvitationToken(UUID teacherId, String eventId, UUID classId) {
        if (teacherId == null || eventId == null || eventId.isBlank() || classId == null) {
            throw new IllegalArgumentException("Invalid trial invitation coordinates");
        }
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(key.getEncoded(), "HmacSHA256"));
            String payload = "mindcrafti-trial-invite:v2:" + teacherId + ":" + eventId + ":" + classId;
            return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                    mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException unavailable) {
            throw new IllegalStateException("Cannot create trial invitation", unavailable);
        }
    }

    /** JWT for a single trial classroom; never a general student login. */
    public String generateTrialToken(User guest, UUID classId, Instant expiry) {
        if (guest == null || !guest.isTrialGuest() || guest.getRole() != Role.STUDENT
                || classId == null || expiry == null || !expiry.isAfter(Instant.now())) {
            throw new IllegalArgumentException("Invalid scoped trial access");
        }
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(guest.getId().toString())
                .claim("role", Role.STUDENT.name())
                .claim("trialClassId", classId.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(key).compact();
    }

    /** Validated trial claim; returning empty also covers ordinary account JWTs. */
    public Optional<UUID> trialClassId(String token) {
        try {
            String raw = parseClaims(token).get("trialClassId", String.class);
            return raw == null ? Optional.empty() : Optional.of(UUID.fromString(raw));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    public Instant expiresAt(String token) {
        return parseClaims(token).getExpiration().toInstant();
    }

    /** Returns the claims of a valid token, or empty for anything invalid, tampered or expired. */
    public Optional<TokenClaims> verify(String token) {
        try {
            Claims claims = parseClaims(token);
            UUID userId = UUID.fromString(claims.getSubject());
            Role role = Role.valueOf(claims.get("role", String.class));
            return Optional.of(new TokenClaims(userId, role));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
