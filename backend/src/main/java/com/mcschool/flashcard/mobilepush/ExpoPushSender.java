package com.mcschool.flashcard.mobilepush;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Send only to previously registered, account-scoped push tokens. */
@Component
public class ExpoPushSender {
    private static final URI EXPO = URI.create("https://exp.host/--/api/v2/push/send");
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper mapper;

    public ExpoPushSender(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public int sendTest(List<String> tokens) {
        try {
            var payload = tokens.stream().map(token -> Map.of(
                    "to", token,
                    "title", "Mindcrafti",
                    "body", "Тестовое сообщение от школы Mindcrafti",
                    "sound", "default"
            )).toList();
            String json = mapper.writeValueAsString(payload);
            HttpRequest request = HttpRequest.newBuilder(EXPO)
                    .timeout(Duration.ofSeconds(12))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Expo rejected push request");
            }
            // Expo HTTP 200 is a receipt of acceptance, not a delivery guarantee.
            // Production integration must inspect push tickets/receipts and prune invalid tokens.
            return tokens.size();
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Expo push request interrupted");
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Expo push service unavailable");
        }
    }
}
