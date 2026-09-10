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
    private static final String MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
    private static final String DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
    private static final String PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";
    private static final String ADMIN_STATE_PREFIX = "admin:";

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
        return beginConnection(requireTeacher(caller.id()), false);
    }

    /** Admin starts OAuth for a selected teacher, but Google credentials are still entered only on Google. */
    @Transactional
    public GoogleCalendarConnectionResponse adminConnection(UUID teacherId) {
        return beginConnection(requireTeacher(teacherId), true);
    }

    private GoogleCalendarConnectionResponse beginConnection(User teacher, boolean adminFlow) {
        if (teacher.getGoogleCalendarRefreshToken() != null && !teacher.getGoogleCalendarRefreshToken().isBlank()) {
            return new GoogleCalendarConnectionResponse(true, null);
        }

        if (!isConfigured()) {
            return new GoogleCalendarConnectionResponse(false, null);
        }

        String random = UUID.randomUUID().toString();
        String state = adminFlow
                ? ADMIN_STATE_PREFIX + teacher.getId() + ":" + random
                : random;
        teacher.beginGoogleCalendarOauth(state, Instant.now().plus(15, ChronoUnit.MINUTES));
        return new GoogleCalendarConnectionResponse(false, authorizationUrl(state, teacher.getEmail()));
    }

    @Transactional
    public String handleCallback(String state, String code, String error) {
        if (error != null && !error.isBlank()) return callbackRedirect(state, "error");
        if (state == null || state.isBlank() || code == null || code.isBlank()) return callbackRedirect(state, "error");

        User teacher = userRepository.findByGoogleCalendarOauthState(state).orElse(null);
        if (teacher == null || !teacher.isGoogleCalendarOauthStateValid(state, Instant.now())) {
            return callbackRedirect(state, "error");
        }

        ensureConfigured();
        Map<String, Object> token = exchangeCode(code);
        String refreshToken = stringValue(token.get("refresh_token"));
        if (refreshToken.isBlank()) return callbackRedirect(state, "missing_refresh_token");
        teacher.connectGoogleCalendar(refreshToken);
        return callbackRedirect(state, "connected");
    }

    @Transactional
    public void disconnect(AuthenticatedUser caller) {
        requireTeacher(caller.id()).disconnectGoogleCalendar();
    }

    @Transactional
    public void adminDisconnect(UUID teacherId) {
        requireTeacher(teacherId).disconnectGoogleCalendar();
    }

    public String accessTokenForTeacher(UUID teacherId) {
        User teacher = requireTeacher(teacherId);
        String refreshToken = teacher.getGoogleCalendarRefreshToken();
        if (refreshToken == null || refreshToken.isBlank()) return null;
        ensureConfigured();
        return refreshAccessToken(refreshToken);
    }

    private String authorizationUrl(String state, String loginHint) {
        String scopes = String.join(" ", CALENDAR_SCOPE, MEET_SCOPE, DRIVE_READ_SCOPE, PROFILE_SCOPE);
        String url = AUTH_URL
                + "?client_id=" + enc(clientId)
                + "&redirect_uri=" + enc(redirectUri)
                + "&response_type=code"
                + "&scope=" + enc(scopes)
                + "&access_type=offline"
                + "&prompt=consent"
                + "&include_granted_scopes=true"
                + "&state=" + enc(state);
        if (loginHint != null && !loginHint.isBlank()) {
            url += "&login_hint=" + enc(loginHint.trim());
        }
        return url;
    }

    private String callbackRedirect(String state, String status) {
        UUID teacherId = adminTeacherIdFromState(state);
        if (teacherId != null) {
            return frontendBaseUrl + "/admin/lessons?teacherId=" + teacherId + "&googleCalendar=" + status;
        }
        return frontendBaseUrl + "/teacher/lessons?googleCalendar=" + status;
    }

    private UUID adminTeacherIdFromState(String state) {
        if (state == null || !state.startsWith(ADMIN_STATE_PREFIX)) return null;
        String remainder = state.substring(ADMIN_STATE_PREFIX.length());
        int separator = remainder.indexOf(':');
        if (separator <= 0) return null;
        try {
            return UUID.fromString(remainder.substring(0, separator));
        } catch (IllegalArgumentException ignored) {
            return null;
        }
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

    private boolean isConfigured() {
        return clientId != null && !clientId.isBlank()
                && clientSecret != null && !clientSecret.isBlank()
                && redirectUri != null && !redirectUri.isBlank();
    }

    private void ensureConfigured() {
        if (!isConfigured()) {
            throw new IllegalStateException("Google Calendar OAuth is not configured");
        }
    }

    private String stringValue(Object value) { return value == null ? "" : String.valueOf(value); }
    private String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
