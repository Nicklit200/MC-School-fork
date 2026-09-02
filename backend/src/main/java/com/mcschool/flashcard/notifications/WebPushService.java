package com.mcschool.flashcard.notifications;

import java.nio.charset.StandardCharsets;
import java.security.Security;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
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
        if (!isConfigured()) {
            throw new IllegalStateException("Web Push is not configured");
        }
        String payload = "{\"title\":\"" + json(title) + "\",\"body\":\"" + json(body)
                + "\",\"url\":\"" + json(url) + "\"}";
        try {
            PushService pushService = new PushService(publicKey, privateKey, subject);
            Notification notification = new Notification(
                    subscription.getEndpoint(),
                    subscription.getP256dh(),
                    subscription.getAuth(),
                    payload.getBytes(StandardCharsets.UTF_8));
            var response = pushService.send(notification);
            int status = response.getStatusLine().getStatusCode();
            if (status == 404 || status == 410) {
                subscriptionRepository.delete(subscription);
            } else if (status >= 400) {
                throw new IllegalStateException("Push provider returned HTTP " + status);
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
