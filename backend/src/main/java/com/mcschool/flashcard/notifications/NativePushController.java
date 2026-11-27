package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Native TestFlight/Android app: no Web Push endpoint or user ID is accepted. */
@RestController
@RequestMapping("/api/v1/mobile-push")
public class NativePushController {
    public record DeviceRequest(
        @NotBlank @Size(max=256)
        @Pattern(regexp="^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]{8,220}\\]$")
        String token,
        @NotBlank @Pattern(regexp="^(ios|android)$") String platform) {}

    public record DeleteRequest(
        @NotBlank @Size(max=256)
        @Pattern(regexp="^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]{8,220}\\]$")
        String token) {}

    private final NativePushDevices devices;
    public NativePushController(NativePushDevices devices) { this.devices=devices; }

    @PostMapping("/devices")
    public ResponseEntity<Void> register(@AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody DeviceRequest request) {
        devices.register(user,request.token(),request.platform());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/devices")
    public ResponseEntity<Void> unregister(@AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody DeleteRequest request) {
        devices.unregister(user,request.token());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/status")
    public Map<String,Object> status(@AuthenticationPrincipal AuthenticatedUser user) {
        int count=devices.count(user.id());
        return Map.of("registeredDevices",count,"ready",count>0);
    }

    @PostMapping("/test")
    public Map<String,Integer> test(@AuthenticationPrincipal AuthenticatedUser user) {
        return Map.of("accepted",devices.sendTest(user));
    }
}
