package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GoogleCalendarConnectionResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class GoogleCalendarOAuthService {

    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;
    private final String frontendBaseUrl;

    public GoogleCalendarOAuthService(UserRepository userRepository,
                                      ObjectMapper objectMapper,
                                      @Value("${GOOGLE_CALENDAR_OAUTH_CLIENT_ID:}") String clientId,
                                      @Value("${GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET:}") String clientSecret,
                                      @Value("${GOOGLE_CALENDAR_OAUTH_REDIRECT_URI:http://localhost:8080/api/v1/google-calendar/oauth/callback}") String redirectUri,
                                      @Value("${app.frontend.base-url}") String frontendBaseUrl) {
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.frontendBaseUrl = frontendBaseUrl;
    }

    @Transactional
    public GoogleCalendarConnectionResponse connection(AuthenticatedUser caller) {
        User teacher = requireTeacher(caller.id());
        if (teacher.getGoogleCalendarRefreshToken() != null && !teacher.getGoogleCalendarRefreshToken().isBlank()) {
            return new GoogleCalendarConnectionResponse(true, null);
        }
        ensureConfigured();
        String state = UUID.randomUUID().toString();
        teacher.beginGoogleCalendarOauth(state, Instant.now().plus(15, ChronoUnit.MINUTES));
        return new GoogleCalendarConnectionResponse(false, authorizationUrl(state));
    }

    @Transactional
    public String handleCallback(String state, String code, String error) {
        if (error != null && !error.isBlank()) return frontendBaseUrl + "/teacher/lessons?googleCalendar=error";
        if (state == null || state.isBlank() || code == null || code.isBlank()) return frontendBaseUrl + "/teacher/lessons?googleCalendar=error";

        User teacher = userRepository.findByGoogleCalendarOauthState(state).orElse(null);
        if (teacher == null || !teacher.isGoogleCalendarOauthStateValid(state, Instant.now())) {
            return frontendBaseUrl + "/teacher/lessons?googleCalendar=error";
        }

        ensureConfigured();
        Map<String, Object> token = exchangeCode(code);
        String refreshToken = stringValue(token.get("refresh_token"));
        if (refreshToken.isBlank()) return frontendBaseUrl + "/teacher/lessons?googleCalendar=missing_refresh_token";
        teacher.connectGoogleCalendar(refreshToken);
        return frontendBaseUrl + "/teacher/lessons?googleCalendar=connected";
    }

    @Transactional
    public void disconnect(AuthenticatedUser caller) {
        requireTeacher(caller.id()).disconnectGoogleCalendar();
    }

    public String accessTokenForTeacher(UUID teacherId) {
        User teacher = requireTeacher(teacherId);
        String refreshToken = teacher.getGoogleCalendarRefreshToken();
        if (refreshToken == null || refreshToken.isBlank()) return null;
        ensureConfigured();
        return refreshAccessToken(refreshToken);
    }

    private String authorizationUrl(String state) {
        return AUTH_URL
                + "?client_id=" + enc(clientId)
                + "&redirect_uri=" + enc(redirectUri)
                + "&response_type=code"
                + "&scope=" + enc(CALENDAR_SCOPE)
                + "&access_type=offline"
                + "&prompt=consent"
                + "&include_granted_scopes=true"
                + "&state=" + enc(state);
    }

    private Map<String, Object> exchangeCode(String code) {
        String form = "code=" + enc(code)
                + "&client_id=" + enc(clientId)
                + "&client_secret=" + enc(clientSecret)
                + "&redirect_uri=" + enc(redirectUri)
                + "&grant_type=authorization_code";
        return postToken(form);
    }

    private String refreshAccessToken(String refreshToken) {
        String form = "client_id=" + enc(clientId)
                + "&client_secret=" + enc(clientSecret)
                + "&refresh_token=" + enc(refreshToken)
                + "&grant_type=refresh_token";
        Map<String, Object> payload = postToken(form);
        String accessToken = stringValue(payload.get("access_token"));
        if (accessToken.isBlank()) throw new IllegalStateException("Google did not return an access token");
        return accessToken;
    }

    private Map<String, Object> postToken(String form) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(TOKEN_URL))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(form))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google OAuth returned HTTP " + response.statusCode());
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            return payload;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google OAuth request failed", ex);
        }
    }

    private User requireTeacher(UUID id) {
        return userRepository.findById(id)
                .filter(user -> !user.isArchived() && user.getRole().name().equals("TEACHER"))
                .orElseThrow(() -> new IllegalStateException("Teacher account not found"));
    }

    private void ensureConfigured() {
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank() || redirectUri == null || redirectUri.isBlank()) {
            throw new IllegalStateException("Google Calendar OAuth is not configured");
        }
    }

    private String stringValue(Object value) { return value == null ? "" : String.valueOf(value); }
    private String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
