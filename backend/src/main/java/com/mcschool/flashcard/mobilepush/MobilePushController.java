package com.mcschool.flashcard.mobilepush;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * All routes require the ordinary Mindcrafti JWT.
 * A client may only register, unregister, or test its own devices.
 */
@RestController
@RequestMapping("/api/v1/mobile-push")
public class MobilePushController {
    private final JdbcTemplate jdbc;
    private final ExpoPushSender sender;
    private final ConcurrentHashMap<UUID, Instant> lastTest = new ConcurrentHashMap<>();

    public MobilePushController(JdbcTemplate jdbc, ExpoPushSender sender) {
        this.jdbc = jdbc;
        this.sender = sender;
    }

    public record DeviceRequest(
            @NotBlank @Size(max = 256)
            @Pattern(regexp = "^(Expo(nent)?PushToken)\\[[A-Za-z0-9_-]+\\]$")
            String token,
            @NotBlank @Pattern(regexp = "ios|android") String platform) {}

    public record DeviceDeleteRequest(
            @NotBlank @Size(max = 256)
            @Pattern(regexp = "^(Expo(nent)?PushToken)\\[[A-Za-z0-9_-]+\\]$")
            String token) {}

    @PostMapping("/devices")
    public Map<String, Object> register(@AuthenticationPrincipal AuthenticatedUser user,
                                         @Valid @RequestBody DeviceRequest request) {
        // On shared devices, a token can belong to only one school user.
        // An account switch atomically reassigns the device to the current user.
        jdbc.update("""
                INSERT INTO mobile_push_devices (id, user_id, expo_push_token, platform)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (expo_push_token) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    platform = EXCLUDED.platform,
                    updated_at = CURRENT_TIMESTAMP
                """, UUID.randomUUID(), user.id(), request.token(), request.platform());
        return Map.of("registered", true);
    }

    @DeleteMapping("/devices")
    public Map<String, Object> unregister(@AuthenticationPrincipal AuthenticatedUser user,
                                           @Valid @RequestBody DeviceDeleteRequest request) {
        jdbc.update("DELETE FROM mobile_push_devices WHERE user_id = ? AND expo_push_token = ?",
                user.id(), request.token());
        return Map.of("registered", false);
    }

    @PostMapping("/test")
    public Map<String, Object> test(@AuthenticationPrincipal AuthenticatedUser user) {
        Instant now = Instant.now();
        Instant previous = lastTest.putIfAbsent(user.id(), now);
        if (previous != null) {
            if (Duration.between(previous, now).getSeconds() < 60) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Wait 60 seconds before sending another test");
            }
            lastTest.put(user.id(), now);
        }
        var tokens = jdbc.queryForList(
                "SELECT expo_push_token FROM mobile_push_devices WHERE user_id = ? LIMIT 10",
                String.class, user.id());
        if (tokens.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No registered device");
        }
        try {
            int queued = sender.sendTest(tokens);
            return Map.of("queued", queued);
        } catch (RuntimeException ex) {
            lastTest.remove(user.id(), now);
            throw ex;
        }
    }
}
