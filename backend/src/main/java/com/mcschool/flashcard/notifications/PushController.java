package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/push")
public class PushController {

    private static final Logger log = LoggerFactory.getLogger(PushController.class);

    private final PushSubscriptionRepository subscriptionRepository;
    private final UserRepository userRepository;
    private final WebPushService webPushService;

    public PushController(PushSubscriptionRepository subscriptionRepository,
                          UserRepository userRepository,
                          WebPushService webPushService) {
        this.subscriptionRepository = subscriptionRepository;
        this.userRepository = userRepository;
        this.webPushService = webPushService;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        return Map.of("enabled", webPushService.isConfigured(), "publicKey", webPushService.publicKey());
    }

    /** Current account only. Exposes readiness, never device endpoints or VAPID secrets. */
    @GetMapping("/status")
    @Transactional(readOnly = true)
    public Map<String, Object> status(@AuthenticationPrincipal AuthenticatedUser principal) {
        User user = userRepository.findById(principal.id()).orElseThrow();
        int devices = subscriptionRepository.findAllByUserId(principal.id()).size();
        return Map.of(
                "enabled", webPushService.isConfigured(),
                "registeredDevices", devices,
                "ready", webPushService.isConfigured() && devices > 0,
                "emailAvailable", user.getEmail() != null && !user.getEmail().isBlank());
    }

    /** Administrator's diagnostics: who can actually receive evening reminders? */
    @GetMapping("/admin/parents")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> parentDeliveryReadiness() {
        return userRepository.findAdminAccountsByRole(Role.PARENT).stream()
                .filter(parent -> parent.getStatus() == UserStatus.ACTIVE && !parent.isArchived())
                .map(parent -> Map.<String, Object>of(
                        "parentId", parent.getId().toString(),
                        "registeredDevices", subscriptionRepository.findAllByUserId(parent.getId()).size(),
                        "emailAvailable", parent.getEmail() != null && !parent.getEmail().isBlank(),
                        "linkedChildren", userRepository.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(
                                parent.getId()).size()
                )).toList();
    }

    @PostMapping("/subscriptions")
    @Transactional
    public ResponseEntity<Void> subscribe(@AuthenticationPrincipal AuthenticatedUser principal,
                                          @Valid @RequestBody PushSubscriptionRequest request) {
        User user = userRepository.findById(principal.id()).orElseThrow();
        PushSubscription subscription = subscriptionRepository.findByEndpoint(request.endpoint())
                .orElseGet(() -> PushSubscription.create(user, request.endpoint(), request.p256dh(), request.auth()));
        // A browser/device may keep the same push endpoint after another account used it.
        // Always bind the endpoint to the currently authenticated account.
        subscription.reassignTo(user);
        subscription.updateKeys(request.p256dh(), request.auth());
        subscriptionRepository.save(subscription);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/subscriptions")
    @Transactional
    public ResponseEntity<Void> unsubscribe(@Valid @RequestBody PushSubscriptionRequest request) {
        subscriptionRepository.deleteByEndpoint(request.endpoint());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/test")
    @Transactional(readOnly = true)
    public ResponseEntity<Void> test(@AuthenticationPrincipal AuthenticatedUser principal) {
        if (!webPushService.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Web Push is not configured");
        }
        var subscriptions = subscriptionRepository.findAllByUserId(principal.id());
        if (subscriptions.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "No push subscriptions found for this account");
        }
        String url = principal.role() == Role.PARENT ? "/parent" : "/today";
        int failed = 0;
        for (PushSubscription subscription : subscriptions) {
            try {
                webPushService.send(subscription, "Mindcrafti School", "Тестовое уведомление работает 🎉", url);
            } catch (Exception e) {
                failed++;
                log.warn("Failed to send test push to subscription {}", subscription.getId(), e);
            }
        }
        if (failed > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Push delivery failed for " + failed + " of " + subscriptions.size() + " devices");
        }
        return ResponseEntity.noContent().build();
    }
}
