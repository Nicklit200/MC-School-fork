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
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class GoogleCalendarLessonService {

    private static final String CALENDAR_API = "https://www.googleapis.com/calendar/v3";

    private final ObjectMapper objectMapper;
    private final StudentGroupRepository groupRepository;
    private final GoogleCalendarOAuthService oauthService;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public GoogleCalendarLessonService(ObjectMapper objectMapper,
                                       StudentGroupRepository groupRepository,
                                       GoogleCalendarOAuthService oauthService) {
        this.objectMapper = objectMapper;
        this.groupRepository = groupRepository;
        this.oauthService = oauthService;
    }

    public List<GroupLessonResponse> listGroupLessons(AuthenticatedUser teacher) {
        String accessToken = oauthService.accessTokenForTeacher(teacher.id());
        if (accessToken == null || accessToken.isBlank()) return List.of();

        List<StudentGroup> groups = groupRepository.findAllByTeacherIdOrderByNameAsc(teacher.id());

        Instant now = Instant.now();
        String url = CALENDAR_API + "/calendars/primary/events"
                + "?singleEvents=true"
                + "&orderBy=startTime"
                + "&timeMin=" + enc(now.minus(12, ChronoUnit.HOURS).toString())
                + "&timeMax=" + enc(now.plus(21, ChronoUnit.DAYS).toString())
                + "&maxResults=250"
                + "&fields=" + enc("items(id,summary,start,end,hangoutLink,htmlLink,conferenceData(entryPoints(entryPointType,uri)))");

        Map<String, Object> payload = getJson(url, accessToken);
        Object rawItems = payload.get("items");
        if (!(rawItems instanceof List<?> items)) return List.of();

        List<GroupLessonResponse> result = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> rawMap)) continue;
            Map<String, Object> event = asMap(rawMap);
            String title = stringValue(event.get("summary"));
            StudentGroup group = matchGroup(groups, title);

            Instant startsAt = eventInstant(event.get("start"));
            Instant endsAt = eventInstant(event.get("end"));
            if (startsAt == null || endsAt == null) continue;

            String meetUrl = stringValue(event.get("hangoutLink"));
            if (meetUrl.isBlank()) meetUrl = conferenceMeetUrl(event.get("conferenceData"));
            String displayTitle = title.isBlank() ? "Google Calendar" : title;

            result.add(new GroupLessonResponse(
                    stringValue(event.get("id")),
                    group == null ? null : group.getId(),
                    group == null ? null : group.getName(),
                    displayTitle,
                    startsAt,
                    endsAt,
                    meetUrl.isBlank() ? null : meetUrl,
                    blankToNull(stringValue(event.get("htmlLink")))
            ));
        }

        return result.stream().sorted(Comparator.comparing(GroupLessonResponse::startsAt)).toList();
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
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
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
            if ("video".equals(String.valueOf(entry.get("entryPointType")))) return stringValue(entry.get("uri"));
        }
        return "";
    }

    private Map<String, Object> getJson(String url, String accessToken) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken)
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

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object value) { return (Map<String, Object>) value; }
    private String stringValue(Object value) { return value == null ? "" : String.valueOf(value); }
    private String blankToNull(String value) { return value == null || value.isBlank() ? null : value; }
    private String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
