package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/integrations")
public class LessonPreparationIntegrationController {

    private static final String API_KEY_HEADER = "X-Mindcrafti-Api-Key";

    private final String apiKey;
    private final UserRepository userRepository;
    private final GoogleCalendarLessonService calendarLessonService;
    private final LessonPreparationService preparationService;

    public LessonPreparationIntegrationController(
            @Value("${MINDCRAFTI_LESSON_IMPORT_API_KEY:}") String apiKey,
            UserRepository userRepository,
            GoogleCalendarLessonService calendarLessonService,
            LessonPreparationService preparationService) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.userRepository = userRepository;
        this.calendarLessonService = calendarLessonService;
        this.preparationService = preparationService;
    }

    @GetMapping("/lessons")
    public List<GroupLessonResponse> lessons(
            @RequestHeader(value = API_KEY_HEADER, required = false) String suppliedApiKey,
            @RequestParam String teacherEmail) {
        requireApiKey(suppliedApiKey);
        AuthenticatedUser teacher = requireTeacher(teacherEmail);
        return calendarLessonService.listGroupLessons(teacher);
    }

    @PostMapping(value = "/lesson-preparations/{eventId}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public LessonPreparationResponse prepare(
            @RequestHeader(value = API_KEY_HEADER, required = false) String suppliedApiKey,
            @PathVariable String eventId,
            @RequestParam String teacherEmail,
            @RequestParam(required = false) String homeworkNotes,
            @RequestParam(required = false) String difficulties,
            @RequestParam(required = false) String lessonPlan,
            @RequestParam(value = "workbook", required = false) MultipartFile workbook,
            @RequestParam(value = "answers", required = false) MultipartFile answers) throws Exception {
        requireApiKey(suppliedApiKey);
        AuthenticatedUser teacher = requireTeacher(teacherEmail);
        requireUpcomingEvent(teacher, eventId);

        LessonPreparationResponse current = preparationService.getOrCreate(teacher, eventId);
        UpdateLessonPreparationRequest merged = new UpdateLessonPreparationRequest(
                homeworkNotes != null ? homeworkNotes : current.homeworkNotes(),
                difficulties != null ? difficulties : current.difficulties(),
                lessonPlan != null ? lessonPlan : current.lessonPlan());

        LessonPreparationResponse result = preparationService.update(teacher, eventId, merged);
        if (workbook != null && !workbook.isEmpty()) {
            String filename = pdfFilename(workbook, "lesson-workbook.pdf");
            result = preparationService.uploadWorkbook(teacher, eventId, filename, workbook.getBytes());
        }
        if (answers != null && !answers.isEmpty()) {
            String filename = pdfFilename(answers, "lesson-answers.pdf");
            result = preparationService.uploadAnswers(teacher, eventId, filename, answers.getBytes());
        }
        return result;
    }

    private String pdfFilename(MultipartFile file, String fallback) {
        String originalFilename = file.getOriginalFilename();
        String filename = originalFilename == null || originalFilename.isBlank() ? fallback : originalFilename;
        if (!filename.toLowerCase().endsWith(".pdf")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Lesson files must be PDF");
        }
        return filename;
    }

    private AuthenticatedUser requireTeacher(String teacherEmail) {
        if (teacherEmail == null || teacherEmail.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "teacherEmail is required");
        }
        User teacher = userRepository.findByEmail(teacherEmail.trim())
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Teacher not found"));
        return new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
    }

    private void requireUpcomingEvent(AuthenticatedUser teacher, String eventId) {
        boolean exists = calendarLessonService.listGroupLessons(teacher).stream()
                .anyMatch(lesson -> lesson.eventId().equals(eventId));
        if (!exists) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Calendar lesson not found in the current lesson window");
        }
    }

    private void requireApiKey(String suppliedApiKey) {
        if (apiKey.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Lesson import integration is not configured");
        }
        byte[] expected = apiKey.getBytes(StandardCharsets.UTF_8);
        byte[] supplied = suppliedApiKey == null ? new byte[0] : suppliedApiKey.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, supplied)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid integration API key");
        }
    }
}
