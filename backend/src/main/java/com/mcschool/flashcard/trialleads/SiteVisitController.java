package com.mcschool.flashcard.trialleads;

import com.mcschool.flashcard.notifications.PushSubscription;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/public/site-visits")
public class SiteVisitController {

    private static final Logger log = LoggerFactory.getLogger(SiteVisitController.class);

    private final UserRepository userRepository;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;

    public SiteVisitController(
            UserRepository userRepository,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService) {
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Boolean> visit(@Valid @RequestBody SiteVisitRequest request) {
        notifyAdmins(request);
        return Map.of("accepted", true);
    }

    private void notifyAdmins(SiteVisitRequest request) {
        if (!webPushService.isConfigured()) return;

        String path = clean(request.path(), 160);
        String source = clean(request.source(), 240);
        String referrer = clean(request.referrer(), 240);

        StringBuilder body = new StringBuilder("Кто-то открыл mindcrafti.de");
        if (!source.isBlank()) body.append(" · источник: ").append(source);
        if (!path.isBlank()) body.append(" · ").append(path);
        if (!referrer.isBlank()) body.append(" · переход: ").append(referrer);

        try {
            for (var admin : userRepository.findAllByRoleOrderByFullNameAsc(Role.ADMIN)) {
                for (PushSubscription subscription : subscriptionRepository.findAllByUserId(admin.getId())) {
                    try {
                        webPushService.send(
                                subscription,
                                "Новый посетитель сайта",
                                body.toString(),
                                "/admin/leads");
                    } catch (Exception e) {
                        log.warn("Failed to send site visit push to admin {}", admin.getId(), e);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to dispatch site visit push notifications", e);
        }
    }

    private static String clean(String value, int maxLength) {
        if (value == null) return "";
        String cleaned = value.strip().replaceAll("[\\r\\n]+", " ");
        return cleaned.substring(0, Math.min(cleaned.length(), maxLength));
    }

    public record SiteVisitRequest(
            @Size(max = 160) String path,
            @Size(max = 240) String source,
            @Size(max = 240) String referrer
    ) {}
}
