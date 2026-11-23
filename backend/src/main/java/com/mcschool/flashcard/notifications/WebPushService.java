package com.mcschool.flashcard.notifications;

import java.nio.charset.StandardCharsets;
import java.security.Security;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.apache.http.util.EntityUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class WebPushService {

    static {
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
    }

    private final PushSubscriptionRepository subscriptionRepository;
    private final String publicKey;
    private final String privateKey;
    private final String subject;

    public WebPushService(
            PushSubscriptionRepository subscriptionRepository,
            @Value("${app.web-push.public-key:}") String publicKey,
            @Value("${app.web-push.private-key:}") String privateKey,
            @Value("${app.web-push.subject:mailto:no-reply@mindcrafti.de}") String subject) {
        this.subscriptionRepository = subscriptionRepository;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.subject = subject;
    }

    public boolean isConfigured() {
        return !publicKey.isBlank() && !privateKey.isBlank();
    }

    public String publicKey() {
        return publicKey;
    }

    public void send(PushSubscription subscription, String title, String body, String url) {
        send(subscription, title, body, url, "mindcrafti-reminder");
    }

    /** The tag separates independently completed lessons on one phone. */
    public void send(PushSubscription subscription, String title, String body, String url, String tag) {
        if (!isConfigured()) {
            throw new IllegalStateException("Web Push is not configured");
        }
        String payload = "{\"title\":\"" + json(title) + "\",\"body\":\"" + json(body)
                + "\",\"url\":\"" + json(url) + "\",\"tag\":\"" + json(tag) + "\"}";
        try {
            PushService pushService = new PushService(publicKey, privateKey, subject);
            Notification notification = new Notification(
                    subscription.getEndpoint(),
                    subscription.getP256dh(),
                    subscription.getAuth(),
                    payload.getBytes(StandardCharsets.UTF_8));
            // The library defaults to obsolete aesgcm, which FCM can reject with 403.
            // Use RFC 8291 aes128gcm for Chrome, Firefox, and Safari push endpoints.
            var response = pushService.send(notification, Encoding.AES128GCM);
            int status = response.getStatusLine().getStatusCode();
            String responseBody = response.getEntity() == null ? "" : EntityUtils.toString(response.getEntity());
            if (status == 404 || status == 410
                    || (status == 400 && responseBody.contains("VapidPkHashMismatch"))) {
                subscriptionRepository.delete(subscription);
                // 404/410 were previously counted as delivered by callers.
                // Removing an expired subscription is NOT a successful push.
                throw new IllegalStateException("Push subscription expired (HTTP " + status + ") and was removed");
            } else if (status >= 400) {
                String endpointHost;
                try {
                    endpointHost = java.net.URI.create(subscription.getEndpoint()).getHost();
                } catch (RuntimeException ignored) {
                    endpointHost = "unknown";
                }
                throw new IllegalStateException(
                        "Push provider returned HTTP " + status
                                + " from " + endpointHost
                                + (responseBody.isBlank() ? "" : ": " + responseBody));
            }
        } catch (Exception e) {
            throw new IllegalStateException("Failed to send web push", e);
        }
    }

    private static String json(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
