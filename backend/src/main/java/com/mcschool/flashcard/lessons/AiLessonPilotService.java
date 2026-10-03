package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanService;
import com.mcschool.flashcard.monthlyplans.dto.MonthlyPlanResponse;
import com.mcschool.flashcard.settings.SchoolPromptSettingsResponse;
import com.mcschool.flashcard.settings.SchoolPromptSettingsService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class AiLessonPilotService {

    public static final UUID PILOT_TEACHER_ID = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    private static final String RESPONSES_API = "https://api.openai.com/v1/responses";

    private final String apiKey;
    private final String model;
    private final ObjectMapper objectMapper;
    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationService preparationService;
    private final LessonPreparationRepository preparationRepository;
    private final MonthlyPlanService monthlyPlanService;
    private final SchoolPromptSettingsService promptSettingsService;
    private final UserRepository userRepository;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public AiLessonPilotService(
            @Value("${OPENAI_API_KEY:}") String apiKey,
            @Value("${OPENAI_MODEL:gpt-5.6-terra}") String model,
            ObjectMapper objectMapper,
            GoogleCalendarLessonService lessonService,
            LessonPreparationService preparationService,
            LessonPreparationRepository preparationRepository,
            MonthlyPlanService monthlyPlanService,
            SchoolPromptSettingsService promptSettingsService,
            UserRepository userRepository) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model = model == null || model.isBlank() ? "gpt-5.6-terra" : model.trim();
        this.objectMapper = objectMapper;
        this.lessonService = lessonService;
        this.preparationService = preparationService;
        this.preparationRepository = preparationRepository;
        this.monthlyPlanService = monthlyPlanService;
        this.promptSettingsService = promptSettingsService;
        this.userRepository = userRepository;
    }

    public Map<String, Object> status(AuthenticatedUser teacher) {
        requirePilotTeacher(teacher);
        return Map.of(
                "pilot", true,
                "configured", !apiKey.isBlank(),
                "model", model,
                "teacherId", teacher.id().toString());
    }

    @Transactional(readOnly = true)
    public Map<String, Object> scheduleSettings(AuthenticatedUser teacher) {
        User user = requirePilotTeacherEntity(teacher);
        String preparationTime = normalizePreparationTime(user.getAiPreparationTime());
        return Map.of(
                "enabled", user.isAiLessonPilotEnabled(),
                "preparationTime", preparationTime,
                "zone", "Europe/Berlin");
    }

    @Transactional
    public Map<String, Object> updateScheduleSettings(
            AuthenticatedUser teacher,
            boolean enabled,
            String preparationTime) {
        User user = requirePilotTeacherEntity(teacher);
        String normalized = normalizePreparationTime(preparationTime);
        user.configureAiLessonPilot(enabled, normalized);
        userRepository.save(user);
        return Map.of(
                "enabled", user.isAiLessonPilotEnabled(),
                "preparationTime", normalized,
                "zone", "Europe/Berlin");
    }

    public boolean isConfigured() {
        return !apiKey.isBlank();
    }

    public LessonPreparationResponse prepareLesson(AuthenticatedUser teacher, String eventId) {
        requireConfiguredPilot(teacher);
        LessonContext context = context(teacher, eventId);
        LessonPreparationResponse current = preparationService.getOrCreate(teacher, eventId);

        String userPrompt = """
                Подготовь следующий урок для преподавателя Mindcrafti.
                Это пилот: ничего не выдавай ученикам автоматически. Результат должен быть черновиком для преподавателя.

                УРОК:
                %s

                НАПРАВЛЕНИЕ / ПЛАН НА МЕСЯЦ:
                %s

                ПРЕДЫДУЩИЙ УРОК:
                %s

                ТЕКУЩИЕ ЗАМЕТКИ ПРЕПОДАВАТЕЛЯ:
                %s

                Требования:
                1. lessonPlan: конкретный план занятия по времени с заданиями, вопросами и ожидаемыми ответами.
                2. difficulties: что проверить в начале и на каких ошибках быть особенно внимательным.
                3. homeworkDraft: черновик короткой домашней работы на 10-15 минут по результатам этого направления.
                4. nextLessonFocus: кратко, куда двигаться дальше, если этот урок пройдет по плану.
                5. Учитывай немецкую школьную терминологию, если это уместно.
                6. Не выдумывай факты об ученике, которых нет в контексте.
                """.formatted(
                context.lessonDescription(),
                emptyFallback(context.monthPlanJson(), "План на месяц пока не заполнен."),
                emptyFallback(context.previousLessonContext(), "Нет предыдущего сохранённого урока."),
                existingPreparation(current));

        GeneratedDraft draft = callOpenAi(context.schoolPrompt(), userPrompt);
        return preparationService.update(
                teacher,
                eventId,
                new UpdateLessonPreparationRequest(
                        draft.homeworkDraft(),
                        draft.difficulties(),
                        draft.lessonPlan(),
                        current.transcriptText()));
    }

    public LessonPreparationResponse analyzeTranscript(AuthenticatedUser teacher, String eventId) {
        requireConfiguredPilot(teacher);
        LessonContext context = context(teacher, eventId);
        LessonPreparationResponse current = preparationService.getOrCreate(teacher, eventId);
        if (current.transcriptText() == null || current.transcriptText().isBlank()) {
            throw new IllegalArgumentException("Сначала сохраните транскрипцию урока.");
        }

        String userPrompt = """
                Проанализируй уже проведённый урок Mindcrafti по транскрипции.
                Это пилот: подготовь только черновик. Не назначай домашнее задание автоматически.

                УРОК:
                %s

                НАПРАВЛЕНИЕ / ПЛАН НА МЕСЯЦ:
                %s

                ТРАНСКРИПЦИЯ:
                %s

                Требования:
                1. difficulties: конкретно зафиксируй ошибки, слабые места и то, что получилось. Если учеников несколько, разделяй по именам, когда это можно уверенно определить из транскрипции.
                2. homeworkDraft: составь домашку на 10-15 минут, направленную именно на ошибки и материал этого урока.
                3. nextLessonFocus: что обязательно проверить и продолжить на следующем уроке.
                4. lessonPlan верни пустой строкой, потому что проведённый план нельзя перезаписывать.
                5. Не приписывай ученику ошибку, если из транскрипции нельзя уверенно понять, кто её сделал.
                """.formatted(
                context.lessonDescription(),
                emptyFallback(context.monthPlanJson(), "План на месяц пока не заполнен."),
                truncate(current.transcriptText(), 30000));

        GeneratedDraft draft = callOpenAi(context.schoolPrompt(), userPrompt);
        String difficulties = draft.difficulties();
        if (!draft.nextLessonFocus().isBlank()) {
            difficulties = difficulties + "\n\n## На следующий урок\n" + draft.nextLessonFocus();
        }
        return preparationService.update(
                teacher,
                eventId,
                new UpdateLessonPreparationRequest(
                        draft.homeworkDraft(),
                        difficulties,
                        current.lessonPlan(),
                        current.transcriptText()));
    }

    private LessonContext context(AuthenticatedUser teacher, String eventId) {
        List<GroupLessonResponse> lessons = lessonService.listGroupLessons(teacher);
        GroupLessonResponse current = lessons.stream()
                .filter(item -> eventId.equals(item.eventId()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Урок не найден в календаре Mindcrafti."));

        String targetType;
        UUID targetId;
        if (current.groupId() != null) {
            targetType = "GROUP";
            targetId = current.groupId();
        } else if (current.studentId() != null) {
            targetType = "STUDENT";
            targetId = current.studentId();
        } else {
            throw new IllegalArgumentException("Сначала привяжите урок к группе или ученику.");
        }

        String month = current.startsAt().atZone(SCHOOL_ZONE).format(DateTimeFormatter.ofPattern("yyyy-MM"));
        MonthlyPlanResponse monthPlan = monthlyPlanService.get(teacher, targetType, targetId, month);
        SchoolPromptSettingsResponse settings = promptSettingsService.readForStaff(teacher);
        String schoolPrompt = current.groupId() != null
                ? settings.groupLessonPrompt()
                : settings.individualLessonPrompt();

        String previous = previousLessonContext(teacher, current, lessons);
        return new LessonContext(
                describeLesson(current),
                monthPlan.planJson(),
                previous,
                schoolPrompt == null ? "" : schoolPrompt);
    }

    private String previousLessonContext(
            AuthenticatedUser teacher,
            GroupLessonResponse current,
            List<GroupLessonResponse> lessons) {
        GroupLessonResponse previous = lessons.stream()
                .filter(item -> item.startsAt().isBefore(current.startsAt()))
                .filter(item -> sameTarget(current, item))
                .max(Comparator.comparing(GroupLessonResponse::startsAt))
                .orElse(null);
        if (previous == null) return "";

        LessonPreparation prep = preparationRepository
                .findByTeacherIdAndEventId(teacher.id(), previous.eventId())
                .orElse(null);
        if (prep == null) return describeLesson(previous);

        StringBuilder value = new StringBuilder(describeLesson(previous));
        append(value, "План", prep.getLessonPlan());
        append(value, "Сложности", prep.getDifficulties());
        append(value, "Домашка / заметки", prep.getHomeworkNotes());
        append(value, "Транскрипция", truncate(prep.getTranscriptText(), 12000));
        return truncate(value.toString(), 18000);
    }

    private boolean sameTarget(GroupLessonResponse a, GroupLessonResponse b) {
        if (a.groupId() != null) return a.groupId().equals(b.groupId());
        return a.studentId() != null && a.studentId().equals(b.studentId());
    }

    private String describeLesson(GroupLessonResponse lesson) {
        String target = lesson.groupId() != null
                ? "Группа: " + lesson.groupName()
                : "Ученик: " + lesson.studentName();
        return target
                + "\nНазвание: " + lesson.title()
                + "\nНачало: " + lesson.startsAt().atZone(SCHOOL_ZONE)
                + "\nУчастники: " + lesson.participantStudentIds().size();
    }

    private String existingPreparation(LessonPreparationResponse prep) {
        StringBuilder value = new StringBuilder();
        append(value, "Домашка / заметки", prep.homeworkNotes());
        append(value, "Сложности", prep.difficulties());
        append(value, "План", prep.lessonPlan());
        return value.length() == 0 ? "Нет." : value.toString();
    }

    private GeneratedDraft callOpenAi(String schoolPrompt, String userPrompt) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("model", model);
            payload.put("input", List.of(
                    Map.of(
                            "role", "system",
                            "content", "Ты методист Mindcrafti. Следуй школьному промту как базовой инструкции.\n\nШКОЛЬНЫЙ ПРОМТ:\n" + truncate(schoolPrompt, 24000)),
                    Map.of("role", "user", "content", userPrompt)));
            payload.put("reasoning", Map.of("effort", "medium"));
            payload.put("max_output_tokens", 7000);
            payload.put("text", Map.of(
                    "format", Map.of(
                            "type", "json_schema",
                            "name", "mindcrafti_lesson_pilot",
                            "strict", true,
                            "schema", Map.of(
                                    "type", "object",
                                    "properties", Map.of(
                                            "lessonPlan", Map.of("type", "string"),
                                            "difficulties", Map.of("type", "string"),
                                            "homeworkDraft", Map.of("type", "string"),
                                            "nextLessonFocus", Map.of("type", "string")),
                                    "required", List.of("lessonPlan", "difficulties", "homeworkDraft", "nextLessonFocus"),
                                    "additionalProperties", false))));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(RESPONSES_API))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload)))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("OpenAI API вернул HTTP " + response.statusCode() + ": " + apiError(response.body()));
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> body = objectMapper.readValue(response.body(), Map.class);
            String outputText = extractOutputText(body);
            if (outputText.isBlank()) throw new IllegalStateException("OpenAI API вернул пустой ответ.");
            GeneratedDraft draft = objectMapper.readValue(outputText, GeneratedDraft.class);
            return draft == null ? new GeneratedDraft("", "", "", "") : draft;
        } catch (RuntimeException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Не удалось получить ответ OpenAI API: " + ex.getMessage(), ex);
        }
    }

    private String extractOutputText(Map<String, Object> body) {
        Object direct = body.get("output_text");
        if (direct != null && !String.valueOf(direct).isBlank()) return String.valueOf(direct);
        Object rawOutput = body.get("output");
        if (!(rawOutput instanceof List<?> output)) return "";
        for (Object rawItem : output) {
            if (!(rawItem instanceof Map<?, ?> item)) continue;
            Object rawContent = item.get("content");
            if (!(rawContent instanceof List<?> content)) continue;
            for (Object rawPart : content) {
                if (!(rawPart instanceof Map<?, ?> part)) continue;
                if ("output_text".equals(String.valueOf(part.get("type"))) && part.get("text") != null) {
                    return String.valueOf(part.get("text"));
                }
            }
        }
        return "";
    }

    private String apiError(String body) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = objectMapper.readValue(body, Map.class);
            Object rawError = parsed.get("error");
            if (rawError instanceof Map<?, ?> error && error.get("message") != null) {
                return String.valueOf(error.get("message"));
            }
        } catch (Exception ignored) {
        }
        return truncate(body, 500);
    }

    private void requirePilotTeacher(AuthenticatedUser teacher) {
        if (teacher == null || !PILOT_TEACHER_ID.equals(teacher.id())) {
            throw new IllegalArgumentException("AI pilot is enabled only for Nick.");
        }
    }

    private User requirePilotTeacherEntity(AuthenticatedUser teacher) {
        requirePilotTeacher(teacher);
        return userRepository.findById(teacher.id())
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new IllegalArgumentException("Pilot teacher not found."));
    }

    private String normalizePreparationTime(String value) {
        String time = value == null || value.isBlank() ? "10:00" : value.trim();
        if (!time.matches("^(?:[01]\\d|2[0-3]):[0-5]\\d$")) {
            throw new IllegalArgumentException("preparationTime must use HH:mm.");
        }
        return time;
    }

    private void requireConfiguredPilot(AuthenticatedUser teacher) {
        requirePilotTeacher(teacher);
        if (apiKey.isBlank()) {
            throw new IllegalStateException("OPENAI_API_KEY is not configured on the Mindcrafti backend.");
        }
    }

    private void append(StringBuilder builder, String label, String value) {
        if (value == null || value.isBlank()) return;
        if (builder.length() > 0) builder.append("\n\n");
        builder.append("## ").append(label).append("\n").append(value.trim());
    }

    private String emptyFallback(String value, String fallback) {
        return value == null || value.isBlank() || "{}".equals(value.trim()) ? fallback : truncate(value, 24000);
    }

    private String truncate(String value, int maxLength) {
        if (value == null) return "";
        if (value.length() <= maxLength) return value;
        return value.substring(0, maxLength) + "\n[обрезано]";
    }

    public record GeneratedDraft(
            String lessonPlan,
            String difficulties,
            String homeworkDraft,
            String nextLessonFocus) {
        public GeneratedDraft {
            lessonPlan = lessonPlan == null ? "" : lessonPlan.trim();
            difficulties = difficulties == null ? "" : difficulties.trim();
            homeworkDraft = homeworkDraft == null ? "" : homeworkDraft.trim();
            nextLessonFocus = nextLessonFocus == null ? "" : nextLessonFocus.trim();
        }
    }

    private record LessonContext(
            String lessonDescription,
            String monthPlanJson,
            String previousLessonContext,
            String schoolPrompt) {
    }
}
