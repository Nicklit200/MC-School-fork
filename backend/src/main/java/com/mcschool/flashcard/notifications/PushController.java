package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/push")
public class PushController {

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

    @PostMapping("/subscriptions")
    @Transactional
    public ResponseEntity<Void> subscribe(@AuthenticationPrincipal AuthenticatedUser principal,
                                          @Valid @RequestBody PushSubscriptionRequest request) {
        User user = userRepository.findById(principal.id()).orElseThrow();
        PushSubscription subscription = subscriptionRepository.findByEndpoint(request.endpoint())
                .orElseGet(() -> PushSubscription.create(user, request.endpoint(), request.p256dh(), request.auth()));
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
        String url = principal.role() == Role.PARENT ? "/parent" : "/today";
        for (PushSubscription subscription : subscriptionRepository.findAllByUserId(principal.id())) {
            webPushService.send(subscription, "Mindcrafti School", "Тестовое уведомление работает 🎉", url);
        }
        return ResponseEntity.noContent().build();
    }
}
