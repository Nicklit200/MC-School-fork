package com.mcschool.flashcard.trialbooking;

import com.mcschool.flashcard.lessons.GoogleCalendarOAuthService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class PublicTrialBookingService {

    private static final String CALENDAR_API = "https://www.googleapis.com/calendar/v3";
    private static final Duration SLOT_DURATION = Duration.ofMinutes(30);
    private static final String TRIAL_BLOCK_MARKER = "[ПРОБНЫЕ]";

    private final UserRepository userRepository;
    private final GoogleCalendarOAuthService oauthService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final Set<UUID> enabledTeacherIds;
    private final ZoneId zone = ZoneId.of("Europe/Berlin");

    public PublicTrialBookingService(
            UserRepository userRepository,
            GoogleCalendarOAuthService oauthService,
            ObjectMapper objectMapper,
            @Value("${app.trial-booking.enabled-teacher-ids:}") String enabledTeacherIds) {
        this.userRepository = userRepository;
        this.oauthService = oauthService;
        this.objectMapper = objectMapper;
        this.enabledTeacherIds = parseTeacherIds(enabledTeacherIds);
    }

    public List<PublicTrialTeacherResponse> listTeachers() {
        if (enabledTeacherIds.isEmpty()) return List.of();
        return userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(Role.TEACHER, UserStatus.ACTIVE).stream()
                .filter(teacher -> enabledTeacherIds.contains(teacher.getId()))
                .filter(teacher -> teacher.getGoogleCalendarRefreshToken() != null && !teacher.getGoogleCalendarRefreshToken().isBlank())
                .map(teacher -> new PublicTrialTeacherResponse(teacher.getId(), teacher.getFullName()))
                .toList();
    }

    public List<TrialSlotResponse> listSlots(UUID teacherId) {
        User teacher = requireEnabledTeacher(teacherId);
        String accessToken = requireAccessToken(teacher);
        Instant now = Instant.now();
        Instant from = now.plus(90, ChronoUnit.MINUTES);
        Instant until = now.plus(14, ChronoUnit.DAYS);
        List<CalendarEvent> events = listEvents(accessToken, now.minus(1, ChronoUnit.HOURS), until);

        List<CalendarEvent> trialBlocks = events.stream()
                .filter(event -> event.summary().contains(TRIAL_BLOCK_MARKER))
                .toList();
        List<CalendarEvent> occupied = events.stream()
                .filter(event -> !event.summary().contains(TRIAL_BLOCK_MARKER))
                .toList();

        List<TrialSlotResponse> result = new ArrayList<>();
        for (CalendarEvent block : trialBlocks) {
            Instant cursor = ceilToHalfHour(block.startsAt());
            while (!cursor.plus(SLOT_DURATION).isAfter(block.endsAt())) {
                Instant end = cursor.plus(SLOT_DURATION);
                if (!cursor.isBefore(from) && isReasonableLocalTime(cursor, end) && isFree(cursor, end, occupied)) {
                    result.add(new TrialSlotResponse(cursor, end));
                }
                cursor = end;
            }
        }

        return result.stream()
                .distinct()
                .sorted(Comparator.comparing(TrialSlotResponse::startsAt))
                .limit(40)
                .toList();
    }

    public TrialBookingResponse book(TrialBookingRequest request) {
        User teacher = requireEnabledTeacher(request.teacherId());
        Instant startsAt = request.startsAt();
        Instant endsAt = startsAt.plus(SLOT_DURATION);
        boolean offered = listSlots(teacher.getId()).stream()
                .anyMatch(slot -> slot.startsAt().equals(startsAt) && slot.endsAt().equals(endsAt));
        if (!offered) throw new IllegalArgumentException("This trial slot is no longer available");

        String accessToken = requireAccessToken(teacher);
        String title = "Probestunde - " + safeTitle(request.childName());
        String description = String.join("\n",
                "Mindcrafti School - public trial booking",
                "Parent: " + request.parentName(),
                "Child: " + request.childName(),
                "Contact: " + request.contact(),
                "Grade: " + request.grade(),
                "School: " + request.schoolType(),
                "Subject: " + request.subject(),
                "Goal: " + request.goal(),
                "Priority: " + request.priority(),
                request.source() == null || request.source().isBlank() ? "" : "Source: " + request.source());

        Map<String, Object> body = Map.of(
                "summary", title,
                "description", description,
                "start", Map.of("dateTime", startsAt.toString(), "timeZone", zone.getId()),
                "end", Map.of("dateTime", endsAt.toString(), "timeZone", zone.getId()),
                "conferenceData", Map.of("createRequest", Map.of("requestId", UUID.randomUUID().toString(), "conferenceSolutionKey", Map.of("type", "hangoutsMeet")))
        );

        Map<String, Object> event = postJson(
                CALENDAR_API + "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none",
                accessToken,
                body);
        String eventId = stringValue(event.get("id"));
        String meetUrl = stringValue(event.get("hangoutLink"));
        return new TrialBookingResponse(teacher.getId(), teacher.getFullName(), startsAt, endsAt, eventId, meetUrl.isBlank() ? null : meetUrl);
    }

    private User requireEnabledTeacher(UUID teacherId) {
        if (!enabledTeacherIds.contains(teacherId)) throw new IllegalArgumentException("Teacher is not available for public trial booking");
        return userRepository.findById(teacherId)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> user.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new IllegalArgumentException("Teacher is not available"));
    }

    private String requireAccessToken(User teacher) {
        String token = oauthService.accessTokenForTeacher(teacher.getId());
        if (token == null || token.isBlank()) throw new IllegalStateException("Teacher calendar is not connected");
        return token;
    }

    private List<CalendarEvent> listEvents(String accessToken, Instant from, Instant until) {
        String url = CALENDAR_API + "/calendars/primary/events"
                + "?singleEvents=true&orderBy=startTime&maxResults=250"
                + "&timeMin=" + enc(from.toString())
                + "&timeMax=" + enc(until.toString())
                + "&fields=" + enc("items(id,summary,start,end)");
        Map<String, Object> payload = getJson(url, accessToken);
        Object rawItems = payload.get("items");
        if (!(rawItems instanceof List<?> items)) return List.of();

        List<CalendarEvent> events = new ArrayList<>();
        for (Object raw : items) {
            if (!(raw instanceof Map<?, ?> map)) continue;
            Instant start = eventInstant(map.get("start"));
            Instant end = eventInstant(map.get("end"));
            if (start == null || end == null || !end.isAfter(start)) continue;
            events.add(new CalendarEvent(stringValue(map.get("summary")), start, end));
        }
        return events;
    }

    private boolean isFree(Instant start, Instant end, List<CalendarEvent> occupied) {
        return occupied.stream().noneMatch(event -> start.isBefore(event.endsAt()) && end.isAfter(event.startsAt()));
    }

    private boolean isReasonableLocalTime(Instant start, Instant end) {
        ZonedDateTime localStart = start.atZone(zone);
        ZonedDateTime localEnd = end.atZone(zone);
        return localStart.toLocalDate().equals(localEnd.toLocalDate())
                && !localStart.toLocalTime().isBefore(java.time.LocalTime.of(8, 0))
                && !localEnd.toLocalTime().isAfter(java.time.LocalTime.of(21, 0));
    }

    private Instant ceilToHalfHour(Instant instant) {
        ZonedDateTime local = instant.atZone(zone).withSecond(0).withNano(0);
        int minute = local.getMinute();
        int add = minute == 0 || minute == 30 ? 0 : (minute < 30 ? 30 - minute : 60 - minute);
        if (add > 0) local = local.plusMinutes(add);
        return local.toInstant();
    }

    private Instant eventInstant(Object value) {
        if (!(value instanceof Map<?, ?> map)) return null;
        Object dateTime = map.get("dateTime");
        if (dateTime == null) return null;
        try {
            return java.time.OffsetDateTime.parse(String.valueOf(dateTime)).toInstant();
        } catch (Exception ignored) {
            return null;
        }
    }

    private Map<String, Object> getJson(String url, String accessToken) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken)
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new IllegalStateException("Google Calendar returned HTTP " + response.statusCode());
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            return payload;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google Calendar request failed", ex);
        }
    }

    private Map<String, Object> postJson(String url, String accessToken, Map<String, Object> body) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .header("Authorization", "Bearer " + accessToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new IllegalStateException("Google Calendar returned HTTP " + response.statusCode() + ": " + response.body());
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) objectMapper.readValue(response.body(), Map.class);
            return payload;
        } catch (Exception ex) {
            if (ex instanceof RuntimeException runtimeException) throw runtimeException;
            throw new IllegalStateException("Google Calendar booking failed", ex);
        }
    }

    private static Set<UUID> parseTeacherIds(String raw) {
        Set<UUID> result = new HashSet<>();
        if (raw == null || raw.isBlank()) return result;
        for (String value : raw.split(",")) {
            try { result.add(UUID.fromString(value.trim())); } catch (Exception ignored) {}
        }
        return Set.copyOf(result);
    }

    private String safeTitle(String value) {
        return value.replaceAll("[\\r\\n]+", " ").trim().substring(0, Math.min(value.trim().length(), 80));
    }

    private String stringValue(Object value) { return value == null ? "" : String.valueOf(value); }
    private String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private record CalendarEvent(String summary, Instant startsAt, Instant endsAt) {}
}
