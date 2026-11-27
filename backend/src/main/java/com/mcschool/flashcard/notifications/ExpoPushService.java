package com.mcschool.flashcard.notifications;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Sends remote notifications to real Expo iOS/Android builds (not Web Push).
 * Acceptance by Expo is not APNs delivery; callers record ticket IDs for
 * optional receipt diagnostics and never store notification bodies in logs.
 */
@Service
public class ExpoPushService {
    private static final URI ENDPOINT = URI.create("https://exp.host/--/api/v2/push/send");
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8)).build();
    private final ObjectMapper json;
    private final String accessToken;

    public ExpoPushService(ObjectMapper json,
            @Value("${EXPO_PUSH_ACCESS_TOKEN:}") String accessToken) {
        this.json = json;
        this.accessToken = accessToken == null ? "" : accessToken.strip();
    }

    /** HTTP accepted + Expo returned a valid ticket. APNs delivery is asynchronous. */
    public String send(String expoToken, String title, String body, String route) {
        try {
            var payload = json.writeValueAsString(Map.of(
                    "to", expoToken,
                    "title", title,
                    "body", body,
                    "sound", "default",
                    "priority", "high",
                    "data", Map.of("url", route),
                    "channelId", "mindcrafti"));
            HttpRequest.Builder builder = HttpRequest.newBuilder(ENDPOINT)
                    .timeout(Duration.ofSeconds(12))
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload));
            if (!accessToken.isBlank()) builder.header("Authorization", "Bearer " + accessToken);
            HttpResponse<String> response = client.send(builder.build(),
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300)
                throw new IllegalStateException("EXPO_HTTP_" + response.statusCode());
            if (response.body() == null || response.body().length() > 100_000)
                throw new IllegalStateException("EXPO_RESPONSE_UNEXPECTED");
            @SuppressWarnings("unchecked")
            Map<String,Object> answer = json.readValue(response.body(), Map.class);
            Object data = answer.get("data");
            if (data instanceof java.util.List<?> list)
                data = list.isEmpty() ? null : list.get(0);
            if (!(data instanceof Map<?,?> ticket))
                throw new IllegalStateException("EXPO_TICKET_MISSING");
            if (!"ok".equals(ticket.get("status"))) {
                String code = "EXPO_REJECTED";
                if (ticket.get("details") instanceof Map<?,?> details)
                    code = Objects.toString(details.get("error"), code);
                // The provider explicitly says this token is no longer usable.
                if ("DeviceNotRegistered".equals(code))
                    throw new DeviceNotRegisteredException();
                throw new IllegalStateException("EXPO_" + code);
            }
            String ticketId = Objects.toString(ticket.get("id"), "");
            if (ticketId.isBlank())
                throw new IllegalStateException("EXPO_TICKET_ID_MISSING");
            return ticketId;
        } catch (DeviceNotRegisteredException gone) {
            throw gone;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException)
                Thread.currentThread().interrupt();
            throw new IllegalStateException("EXPO_PUSH_DELIVERY_FAILED", failure);
        }
    }

    public static final class DeviceNotRegisteredException extends RuntimeException {
        public DeviceNotRegisteredException() { super("EXPO_DEVICE_NOT_REGISTERED"); }
    }
}
