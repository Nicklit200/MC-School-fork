package com.mcschool.flashcard.liveclasses;

import io.livekit.server.WebhookReceiver;
import livekit.LivekitWebhook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * LiveKit webhook endpoint.
 *
 * <p>Narrowly scoped and unauthenticated by JWT on purpose — the provider cannot
 * hold a user token — but <strong>never unverified</strong>: every request is
 * checked with {@link WebhookReceiver}, which validates the Authorization JWT
 * against the API key/secret and compares a SHA-256 of the <em>raw</em> body to
 * the {@code sha256} claim.
 *
 * <p>The body is therefore taken as a raw {@code String} and verified
 * <em>before</em> anything is parsed or any state is touched.
 */
@RestController
@RequestMapping("/api/v1/online-classes/webhooks/livekit")
public class LiveKitWebhookController {

    private static final Logger log = LoggerFactory.getLogger(LiveKitWebhookController.class);

    private final OnlineClassWebhookService webhookService;
    private final OnlineClassMetrics metrics;

    public LiveKitWebhookController(OnlineClassWebhookService webhookService,
                                    OnlineClassMetrics metrics) {
        this.webhookService = webhookService;
        this.metrics = metrics;
    }

    @PostMapping
    public ResponseEntity<Void> receive(@RequestBody String rawBody,
                                        @RequestHeader(value = "Authorization", required = false)
                                        String authorization) {
        LivekitWebhook.WebhookEvent event;
        try {
            event = webhookService.verify(rawBody, authorization);
        } catch (WebhookVerificationException e) {
            // Never echo the reason to the caller: that would help an attacker
            // distinguish a bad signature from a bad body. A rising rejection
            // rate is the signal worth alerting on.
            metrics.webhookRejected();
            log.warn("Rejected an unverified provider webhook");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        metrics.webhookAccepted();
        webhookService.handle(event);
        // Always 200 once verified: a provider retry storm helps nobody, and
        // duplicate events are handled idempotently.
        return ResponseEntity.ok().build();
    }
}
