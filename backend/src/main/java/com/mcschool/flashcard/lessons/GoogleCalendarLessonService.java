package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class GoogleCalendarLessonService {

    private static final String CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
    private static final String CALENDAR_API = "https://www.googleapis.com/calendar/v3";

    private final ObjectMapper objectMapper;
    private final StudentGroupRepository groupRepository;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String serviceAccountJson;
    private final String calendarId;

    private volatile String cachedAccessToken;
    private volatile long accessTokenExpiresAtEpochSecond;

    public GoogleCalendarLessonService(ObjectMapper objectMapper,
                                       StudentGroupRepository groupRepository,
                                       @Value("${app.google-drive.service-account-json:}") String serviceAccountJson,
                                       @Value("${app.google-calendar.calendar-id:}") String calendarId) {
        this.objectMapper = objectMapper;
        this.groupRepository = groupRepository;
        this.serviceAccountJson = serviceAccountJson;
        this.calendarId = calendarId;
    }

    public List<GroupLessonResponse> listGroupLessons(AuthenticatedUser teacher) {
        if (calendarId == null || calendarId.isBlank()) {
            return List.of();
        }

        List<StudentGroup> groups = groupRepository.findAllByTeacherIdOrderByNameAsc(teacher.id());
        if (groups.isEmpty()) {
            return List.of();
        }

        Instant now = Instant.now();
        String url = CALENDAR_API + "/calendars/" + enc(calendarId) + "/events"
                + "?singleEvents=true"
                + "&orderBy=startTime"
                + "&timeMin=" + enc(now.minus(12, ChronoUnit.HOURS).toString())
                + "&timeMax=" + enc(now.plus(21, ChronoUnit.DAYS).toString())
                + "&maxResults=250"
                + "&fields=" + enc("items(id,summary,start,end,hangoutLink,htmlLink,conferenceData(entryPoints(entryPointType,uri)))");

        Map<String, Object> payload = getJson(url);
        Object rawItems = payload.get("items");
        if (!(rawItems instanceof List<?> items)) {
            return List.of();
        }

        List<GroupLessonResponse> result = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> rawMap)) continue;
            Map<String, Object> event = asMap(rawMap);
            String title = stringValue(event.get("summary"));
            StudentGroup group = matchGroup(groups, title);
            if (group == null) continue;

            Instant startsAt = eventInstant(event.get("start"));
            Instant endsAt = eventInstant(event.get("end"));
            if (startsAt == null || endsAt == null) continue;

            String meetUrl = stringValue(event.get("hangoutLink"));
            if (meetUrl.isBlank()) meetUrl = conferenceMeetUrl(event.get("conferenceData"));

            result.add(new GroupLessonResponse(
                    stringValue(event.get("id")),
                    group.getId(),
                    group.getName(),
                    title.isBlank() ? group.getName() : title,
                    startsAt,
                    endsAt,
                    meetUrl.isBlank() ? null : meetUrl,
                    blankToNull(stringValue(event.get("htmlLink")))
            ));
        }

        return result.stream()
                .sorted(Comparator.comparing(GroupLessonResponse::startsAt))
                .toList();
    }

    private StudentGroup matchGroup(List<StudentGroup> groups, String title) {
        String normalizedTitle = normalize(title);
        StudentGroup best = null;
        int bestLength = -1;
        for (StudentGroup group : groups) {
            String normalizedName = normalize(group.getName());
            if (!normalizedName.isBlank() && normalizedTitle.contains(normalizedName) && normalizedName.length() > bestLength) {
                best = group;
                bestLength = normalizedName.length();
            }
        }
        return best;
    }

    private String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private Instant eventInstant(Object value) {
        if (!(value instanceof Map<?, ?> map)) return null;
        Object dateTime = map.get("dateTime");
        if (dateTime == null) return null;
        try {
            return Instant.parse(String.valueOf(dateTime));
        } catch (Exception ignored) {
            try {
                return java.time.OffsetDateTime.parse(String.valueOf(dateTime)).toInstant();
            } catch (Exception ignoredAgain) {
                return null;
            }
        }
    }

    private String conferenceMeetUrl(Object value) {
        if (!(value instanceof Map<?, ?> data)) return "";
        Object rawEntryPoints = data.get("entryPoints");
        if (!(rawEntryPoints instanceof List<?> entryPoints)) return "";
        for (Object rawEntry : entryPoints) {
            if (!(rawEntry instanceof Map<?, ?> entry)) continue;
            if ("video".equals(String.valueOf(entry.get("entryPointType")))) {
                return stringValue(entry.get("uri"));
            }
        }
        return "";
    }

    private Map<String, Object> getJson(String url) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken())
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google Calendar API returned HTTP " + response.statusCode());
            }
            return asMap(objectMapper.readValue(response.body(), Map.class));
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google Calendar request failed", ex);
        }
    }

    private synchronized String accessToken() {
        long now = Instant.now().getEpochSecond();
        if (cachedAccessToken != null && now < accessTokenExpiresAtEpochSecond - 60) return cachedAccessToken;
        if (serviceAccountJson == null || serviceAccountJson.isBlank()) {
            throw new IllegalStateException("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
        }

        try {
            Map<String, Object> credentials = asMap(objectMapper.readValue(serviceAccountJson, Map.class));
            String clientEmail = required(credentials, "client_email");
            String privateKeyPem = required(credentials, "private_key");
            String tokenUri = credentials.get("token_uri") == null
                    ? "https://oauth2.googleapis.com/token"
                    : stringValue(credentials.get("token_uri"));

            long issuedAt = Instant.now().getEpochSecond();
            String header = base64Url(objectMapper.writeValueAsBytes(Map.of("alg", "RS256", "typ", "JWT")));
            String claims = base64Url(objectMapper.writeValueAsBytes(Map.of(
                    "iss", clientEmail,
                    "scope", CALENDAR_SCOPE,
                    "aud", tokenUri,
                    "iat", issuedAt,
                    "exp", issuedAt + 3600
            )));
            String signingInput = header + "." + claims;

            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initSign(readPrivateKey(privateKeyPem));
            signature.update(signingInput.getBytes(StandardCharsets.UTF_8));
            String assertion = signingInput + "." + base64Url(signature.sign());

            String form = "grant_type=" + enc("urn:ietf:params:oauth:grant-type:jwt-bearer")
                    + "&assertion=" + enc(assertion);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(tokenUri))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(form))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Google OAuth returned HTTP " + response.statusCode());
            }

            Map<String, Object> payload = asMap(objectMapper.readValue(response.body(), Map.class));
            cachedAccessToken = required(payload, "access_token");
            Number expiresIn = payload.get("expires_in") instanceof Number number ? number : 3600;
            accessTokenExpiresAtEpochSecond = issuedAt + expiresIn.longValue();
            return cachedAccessToken;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google service-account authentication failed", ex);
        }
    }

    private PrivateKey readPrivateKey(String pem) throws Exception {
        String normalized = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(normalized);
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private String required(Map<String, Object> map, String key) {
        String value = stringValue(map.get(key));
        if (value.isBlank()) throw new IllegalStateException("Missing service-account field: " + key);
        return value;
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
