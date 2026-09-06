package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GoogleMeetEventStatusResponse;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class GoogleMeetEventsService {

    private static final String WORKSPACE_EVENTS_API = "https://workspaceevents.googleapis.com/v1";
    private static final String PEOPLE_API = "https://people.googleapis.com/v1/people/me?personFields=metadata";
    private static final String MEET_API = "https://meet.googleapis.com/v2/";
    private static final List<String> EVENT_TYPES = List.of(
            "google.workspace.meet.participant.v2.left",
            "google.workspace.meet.conference.v2.ended"
    );

    private final GoogleCalendarOAuthService oauthService;
    private final GoogleMeetTeacherEventStateRepository stateRepository;
    private final PushSubscriptionRepository pushSubscriptionRepository;
    private final WebPushService webPushService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String pubsubTopic;
    private final String webhookToken;
    private final String frontendBaseUrl;

    public GoogleMeetEventsService(
            GoogleCalendarOAuthService oauthService,
            GoogleMeetTeacherEventStateRepository stateRepository,
            PushSubscriptionRepository pushSubscriptionRepository,
            WebPushService webPushService,
            ObjectMapper objectMapper,
            @Value("${GOOGLE_WORKSPACE_EVENTS_PUBSUB_TOPIC:}") String pubsubTopic,
            @Value("${GOOGLE_WORKSPACE_EVENTS_WEBHOOK_TOKEN:}") String webhookToken,
            @Value("${app.frontend.base-url}") String frontendBaseUrl) {
        this.oauthService = oauthService;
        this.stateRepository = stateRepository;
        this.pushSubscriptionRepository = pushSubscriptionRepository;
        this.webPushService = webPushService;
        this.objectMapper = objectMapper;
        this.pubsubTopic = pubsubTopic;
        this.webhookToken = webhookToken;
        this.frontendBaseUrl = frontendBaseUrl;
    }

    public boolean isConfigured() {
        return pubsubTopic != null && !pubsubTopic.isBlank()
                && webhookToken != null && !webhookToken.isBlank();
    }

    @Transactional
    public GoogleMeetEventStatusResponse ensureSubscription(AuthenticatedUser caller) {
        if (!isConfigured()) return status(caller);

        UUID teacherId = caller.id();
        GoogleMeetTeacherEventState existing = stateRepository.findById(teacherId).orElse(null);
        if (existing != null
                && existing.getWorkspaceSubscriptionName() != null
                && existing.getSubscriptionExpiresAt() != null
                && existing.getSubscriptionExpiresAt().isAfter(Instant.now().plus(2, ChronoUnit.HOURS))) {
            return toResponse(existing);
        }

        String accessToken = oauthService.accessTokenForTeacher(teacherId);
        if (accessToken == null || accessToken.isBlank()) return status(caller);

        String googleUserId = currentGoogleUserId(accessToken);
        Map<String, Object> requestBody = Map.of(
                "targetResource", "//cloudidentity.googleapis.com/users/" + googleUserId,
                "eventTypes", EVENT_TYPES,
                "notificationEndpoint", Map.of("pubsubTopic", pubsubTopic),
                "ttl", "86400s"
        );

        Map<String, Object> operation = postJson(WORKSPACE_EVENTS_API + "/subscriptions", accessToken, requestBody);
        Map<String, Object> subscription = waitForOperation(operation, accessToken);
        String subscriptionName = stringValue(subscription.get("name"));
        Instant expiresAt = parseInstant(subscription.get("expireTime"));
        if (subscriptionName.isBlank()) {
            throw new IllegalStateException("Google Workspace Events did not return subscription name");
        }
        if (expiresAt == null) expiresAt = Instant.now().plus(23, ChronoUnit.HOURS);

        GoogleMeetTeacherEventState state = existing == null
                ? GoogleMeetTeacherEventState.create(teacherId)
                : existing;
        state.updateSubscription("users/" + googleUserId, subscriptionName, expiresAt);
        stateRepository.save(state);
        return toResponse(state);
    }

    public GoogleMeetEventStatusResponse status(AuthenticatedUser caller) {
        GoogleMeetTeacherEventState state = stateRepository.findById(caller.id()).orElse(null);
        return state == null
                ? new GoogleMeetEventStatusResponse(isConfigured(), false, null)
                : toResponse(state);
    }

    @Transactional
    public void handlePubSub(String token, Map<String, Object> envelope) {
        if (!isConfigured() || token == null || !constantTimeEquals(webhookToken, token)) {
            throw new IllegalArgumentException("Invalid Google Meet webhook token");
        }

        Object rawMessage = envelope.get("message");
        if (!(rawMessage instanceof Map<?, ?> message)) return;
        String encoded = stringValue(message.get("data"));
        if (encoded.isBlank()) return;

        Map<String, Object> event;
        try {
            byte[] decoded = Base64.getDecoder().decode(encoded);
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = (Map<String, Object>) objectMapper.readValue(decoded, Map.class);
            event = parsed;
        } catch (Exception ex) {
            throw new IllegalArgumentException("Invalid Google Meet event payload", ex);
        }

        String eventType = stringValue(event.get("type"));
        String source = stringValue(event.get("source"));
        String subscriptionName = extractSubscriptionName(source, envelope);
        if (subscriptionName == null) return;

        GoogleMeetTeacherEventState state = stateRepository.findByWorkspaceSubscriptionName(subscriptionName).orElse(null);
        if (state == null) return;

        Instant eventTime = parseInstant(event.get("time"));
        boolean teacherLeft = eventType.endsWith("conference.v2.ended");
        if (!teacherLeft && eventType.endsWith("participant.v2.left")) {
            teacherLeft = isTeacherParticipant(state, event, state.getTeacherId());
        }

        if (teacherLeft) {
            state.markLeft(eventTime);
            stateRepository.save(state);
            sendStopSonioxPush(state.getTeacherId());
        }
    }

    private boolean isTeacherParticipant(GoogleMeetTeacherEventState state, Map<String, Object> event, UUID teacherId) {
        try {
            Object rawData = event.get("data");
            if (!(rawData instanceof Map<?, ?> data)) return false;
            Object rawSession = data.get("participantSession");
            if (!(rawSession instanceof Map<?, ?> session)) return false;
            String sessionName = stringValue(session.get("name"));
            int marker = sessionName.indexOf("/participantSessions/");
            if (marker <= 0) return false;
            String participantName = sessionName.substring(0, marker);
            String accessToken = oauthService.accessTokenForTeacher(teacherId);
            Map<String, Object> participant = getJson(MEET_API + participantName, accessToken);
            Object rawSignedIn = participant.get("signedinUser");
            if (!(rawSignedIn instanceof Map<?, ?> signedIn)) return false;
            return state.getGoogleUserId() != null
                    && state.getGoogleUserId().equals(stringValue(signedIn.get("user")));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private void sendStopSonioxPush(UUID teacherId) {
        if (!webPushService.isConfigured()) return;
        for (var subscription : pushSubscriptionRepository.findAllByUserId(teacherId)) {
            try {
                webPushService.send(
                        subscription,
                        "Останови Soniox",
                        "Ты вышел из Google Meet. Останови запись Soniox и заверши урок.",
                        frontendBaseUrl + "/teacher/lessons"
                );
            } catch (RuntimeException ignored) {
                // One expired device must not prevent other teacher devices from being notified.
            }
        }
    }

    private String currentGoogleUserId(String accessToken) {
        Map<String, Object> person = getJson(PEOPLE_API, accessToken);
        String resourceName = stringValue(person.get("resourceName"));
        if (!resourceName.startsWith("people/") || resourceName.length() <= "people/".length()) {
            throw new IllegalStateException("Google People API did not return current account id");
        }
        return resourceName.substring("people/".length());
    }

    private Map<String, Object> waitForOperation(Map<String, Object> operation, String accessToken) {
        String name = stringValue(operation.get("name"));
        if (name.isBlank()) throw new IllegalStateException("Workspace Events operation name is missing");

        Map<String, Object> current = operation;
        for (int attempt = 0; attempt < 12; attempt++) {
            if (Boolean.TRUE.equals(current.get("done"))) {
                if (current.get("error") != null) throw new IllegalStateException("Workspace Events subscription creation failed: " + current.get("error"));
                Object rawResponse = current.get("response");
                if (rawResponse instanceof Map<?, ?> response) return asMap(response);
                throw new IllegalStateException("Workspace Events operation returned no subscription");
            }
            try {
                Thread.sleep(250L);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while creating Workspace Events subscription", ex);
            }
            current = getJson(WORKSPACE_EVENTS_API + "/" + name, accessToken);
        }
        throw new IllegalStateException("Workspace Events subscription creation timed out");
    }

    private Map<String, Object> getJson(String url, String accessToken) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken)
                    .GET().build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google API returned HTTP " + response.statusCode() + ": " + response.body());
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            return payload;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google API request failed", ex);
        }
    }

    private Map<String, Object> postJson(String url, String accessToken, Object body) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google API returned HTTP " + response.statusCode() + ": " + response.body());
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            return payload;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google API request failed", ex);
        }
    }

    private String extractSubscriptionName(String source, Map<String, Object> envelope) {
        int index = source.indexOf("subscriptions/");
        if (index >= 0) return source.substring(index);
        String pubsubSubscription = stringValue(envelope.get("subscription"));
        index = pubsubSubscription.indexOf("subscriptions/");
        return index >= 0 ? pubsubSubscription.substring(index) : null;
    }

    private GoogleMeetEventStatusResponse toResponse(GoogleMeetTeacherEventState state) {
        boolean subscribed = state.getWorkspaceSubscriptionName() != null
                && state.getSubscriptionExpiresAt() != null
                && state.getSubscriptionExpiresAt().isAfter(Instant.now());
        return new GoogleMeetEventStatusResponse(isConfigured(), subscribed, state.getLastLeftAt());
    }

    private Instant parseInstant(Object value) {
        if (value == null) return null;
        try { return Instant.parse(String.valueOf(value)); }
        catch (Exception ignored) { return null; }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object value) { return (Map<String, Object>) value; }
    private String stringValue(Object value) { return value == null ? "" : String.valueOf(value); }
    private String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private boolean constantTimeEquals(String expected, String actual) {
        if (expected.length() != actual.length()) return false;
        int diff = 0;
        for (int i = 0; i < expected.length(); i++) diff |= expected.charAt(i) ^ actual.charAt(i);
        return diff == 0;
    }
}
