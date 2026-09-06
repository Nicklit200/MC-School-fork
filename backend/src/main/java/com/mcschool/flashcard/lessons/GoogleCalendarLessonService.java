package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class GoogleCalendarLessonService {

    private static final String CALENDAR_API = "https://www.googleapis.com/calendar/v3";

    private final ObjectMapper objectMapper;
    private final StudentGroupRepository groupRepository;
    private final UserRepository userRepository;
    private final GoogleCalendarLessonBindingRepository bindingRepository;
    private final GoogleCalendarOAuthService oauthService;
    private final GoogleMeetEventsService meetEventsService;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public GoogleCalendarLessonService(ObjectMapper objectMapper,
                                       StudentGroupRepository groupRepository,
                                       UserRepository userRepository,
                                       GoogleCalendarLessonBindingRepository bindingRepository,
                                       GoogleCalendarOAuthService oauthService,
                                       GoogleMeetEventsService meetEventsService) {
        this.objectMapper = objectMapper;
        this.groupRepository = groupRepository;
        this.userRepository = userRepository;
        this.bindingRepository = bindingRepository;
        this.oauthService = oauthService;
        this.meetEventsService = meetEventsService;
    }

    @Transactional(readOnly = true)
    public List<GroupLessonResponse> listGroupLessons(AuthenticatedUser teacher) {
        String accessToken = oauthService.accessTokenForTeacher(teacher.id());
        if (accessToken == null || accessToken.isBlank()) return List.of();

        try {
            meetEventsService.ensureSubscription(teacher);
        } catch (RuntimeException ignored) {
            // Calendar must keep working even if Meet event delivery is not configured yet.
        }

        List<StudentGroup> groups = groupRepository.findAllByTeacherIdOrderByNameAsc(teacher.id());
        List<User> students = userRepository.findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacher.id()).stream()
                .filter(user -> user.getRole() == Role.STUDENT)
                .toList();
        Map<String, GoogleCalendarLessonBinding> bindings = new HashMap<>();
        for (GoogleCalendarLessonBinding binding : bindingRepository.findAllByTeacherId(teacher.id())) {
            bindings.put(binding.getEventKey(), binding);
        }

        String connectedGoogleAccount = primaryCalendarId(accessToken);

        Instant now = Instant.now();
        String url = CALENDAR_API + "/calendars/primary/events"
                + "?singleEvents=true"
                + "&orderBy=startTime"
                + "&timeMin=" + enc(now.minus(12, ChronoUnit.HOURS).toString())
                + "&timeMax=" + enc(now.plus(21, ChronoUnit.DAYS).toString())
                + "&maxResults=250"
                + "&fields=" + enc("items(id,recurringEventId,summary,start,end,hangoutLink,htmlLink,conferenceData(entryPoints(entryPointType,uri)))");

        Map<String, Object> payload = getJson(url, accessToken);
        Object rawItems = payload.get("items");
        if (!(rawItems instanceof List<?> items)) return List.of();

        List<GroupLessonResponse> result = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> rawMap)) continue;
            Map<String, Object> event = asMap(rawMap);
            String title = stringValue(event.get("summary"));
            StudentGroup group = matchGroup(groups, title);

            String eventId = stringValue(event.get("id"));
            String recurringEventId = stringValue(event.get("recurringEventId"));
            String bindingKey = recurringEventId.isBlank() ? eventId : recurringEventId;
            GoogleCalendarLessonBinding savedBinding = bindings.get(bindingKey);
            User student = savedBinding == null ? matchStudent(students, title) : savedBinding.getStudent();

            Instant startsAt = eventInstant(event.get("start"));
            Instant endsAt = eventInstant(event.get("end"));
            if (startsAt == null || endsAt == null) continue;

            String meetUrl = stringValue(event.get("hangoutLink"));
            if (meetUrl.isBlank()) meetUrl = conferenceMeetUrl(event.get("conferenceData"));
            if (!meetUrl.isBlank() && connectedGoogleAccount != null && !connectedGoogleAccount.isBlank()) {
                meetUrl = withAuthUser(meetUrl, connectedGoogleAccount);
            }

            String displayTitle = title.isBlank() ? "Google Calendar" : title;
            String calendarUrl = blankToNull(stringValue(event.get("htmlLink")));
            if (calendarUrl != null && connectedGoogleAccount != null && !connectedGoogleAccount.isBlank()) {
                calendarUrl = withAuthUser(calendarUrl, connectedGoogleAccount);
            }

            result.add(new GroupLessonResponse(
                    eventId,
                    bindingKey,
                    group == null ? null : group.getId(),
                    group == null ? null : group.getName(),
                    student == null ? null : student.getId(),
                    student == null ? null : student.getFullName(),
                    displayTitle,
                    startsAt,
                    endsAt,
                    meetUrl.isBlank() ? null : meetUrl,
                    calendarUrl
            ));
        }

        return result.stream().sorted(Comparator.comparing(GroupLessonResponse::startsAt)).toList();
    }

    @Transactional
    public void bindStudent(AuthenticatedUser teacher, String bindingKey, UUID studentId) {
        if (bindingKey == null || bindingKey.isBlank()) {
            throw new IllegalArgumentException("Calendar event key is required");
        }
        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(teacher.id()))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));

        GoogleCalendarLessonBinding binding = bindingRepository.findByTeacherIdAndEventKey(teacher.id(), bindingKey)
                .orElseGet(() -> GoogleCalendarLessonBinding.create(teacherEntity, bindingKey, student));
        binding.changeStudent(student);
        bindingRepository.save(binding);
    }

    private String primaryCalendarId(String accessToken) {
        try {
            Map<String, Object> calendar = getJson(CALENDAR_API + "/calendars/primary?fields=id", accessToken);
            return blankToNull(stringValue(calendar.get("id")));
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private String withAuthUser(String url, String account) {
        String separator = url.contains("?") ? "&" : "?";
        return url + separator + "authuser=" + enc(account);
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

    private User matchStudent(List<User> students, String title) {
        String normalizedTitle = normalize(title);
        User best = null;
        int bestLength = -1;
        for (User student : students) {
            String normalizedName = normalize(student.getFullName());
            if (!normalizedName.isBlank() && normalizedTitle.contains(normalizedName) && normalizedName.length() > bestLength) {
                best = student;
                bestLength = normalizedName.length();
            }
        }
        return best;
    }

    private String normalize(String value) {
        if (value == null) return "";
        String lower = value.toLowerCase(Locale.ROOT);
        StringBuilder transliterated = new StringBuilder(lower.length() * 2);
        for (int i = 0; i < lower.length(); i++) {
            transliterated.append(transliterate(lower.charAt(i)));
        }
        return transliterated.toString().replaceAll("[^a-z0-9]+", " ").trim();
    }

    private String transliterate(char value) {
        return switch (value) {
            case 'а' -> "a";
            case 'б' -> "b";
            case 'в' -> "v";
            case 'г' -> "g";
            case 'д' -> "d";
            case 'е', 'э' -> "e";
            case 'ё' -> "yo";
            case 'ж' -> "zh";
            case 'з' -> "z";
            case 'и', 'й' -> "i";
            case 'к' -> "k";
            case 'л' -> "l";
            case 'м' -> "m";
            case 'н' -> "n";
            case 'о' -> "o";
            case 'п' -> "p";
            case 'р' -> "r";
            case 'с' -> "s";
            case 'т' -> "t";
            case 'у' -> "u";
            case 'ф' -> "f";
            case 'х' -> "h";
            case 'ц' -> "c";
            case 'ч' -> "ch";
            case 'ш' -> "sh";
            case 'щ' -> "sch";
            case 'ы' -> "y";
            case 'ю' -> "yu";
            case 'я' -> "ya";
            case 'ь', 'ъ' -> "";
            default -> String.valueOf(value);
        };
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
                    .GET().build();
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
