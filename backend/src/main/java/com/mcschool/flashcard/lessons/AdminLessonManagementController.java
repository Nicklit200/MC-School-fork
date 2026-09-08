package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * School-admin view over a teacher's real calendar lessons and lesson preparation.
 * This deliberately writes into the same teacherId + eventId preparation records
 * that the teacher sees, so there are no admin copies to keep in sync.
 */
@RestController
@RequestMapping("/api/v1/admin/teachers/{teacherId}")
@PreAuthorize("hasRole('ADMIN')")
public class AdminLessonManagementController {

    private final UserRepository userRepository;
    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationService preparationService;
    private final McpHomeworkSeriesService homeworkSeriesService;

    public AdminLessonManagementController(
            UserRepository userRepository,
            GoogleCalendarLessonService lessonService,
            LessonPreparationService preparationService,
            McpHomeworkSeriesService homeworkSeriesService) {
        this.userRepository = userRepository;
        this.lessonService = lessonService;
        this.preparationService = preparationService;
        this.homeworkSeriesService = homeworkSeriesService;
    }

    @GetMapping("/lessons")
    public List<GroupLessonResponse> lessons(@PathVariable UUID teacherId) {
        return lessonService.listGroupLessons(teacherPrincipal(teacherId));
    }

    @GetMapping("/lesson-preparations/{eventId}")
    public LessonPreparationResponse preparation(@PathVariable UUID teacherId,
                                                 @PathVariable String eventId) {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        requireLesson(teacher, eventId);
        return preparationService.getOrCreate(teacher, eventId);
    }

    @PutMapping("/lesson-preparations/{eventId}")
    public LessonPreparationResponse updatePreparation(@PathVariable UUID teacherId,
                                                       @PathVariable String eventId,
                                                       @RequestBody UpdateLessonPreparationRequest request) {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        requireLesson(teacher, eventId);
        return preparationService.update(teacher, eventId, request);
    }

    @PostMapping(value = "/lesson-preparations/{eventId}/workbook", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public LessonPreparationResponse uploadWorkbook(@PathVariable UUID teacherId,
                                                    @PathVariable String eventId,
                                                    @RequestParam("file") MultipartFile file) throws Exception {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        requireLesson(teacher, eventId);
        return preparationService.uploadWorkbook(teacher, eventId, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/lesson-preparations/{eventId}/workbook")
    public ResponseEntity<byte[]> workbook(@PathVariable UUID teacherId,
                                           @PathVariable String eventId) {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        requireLesson(teacher, eventId);
        LessonPreparation preparation = preparationService.require(teacher, eventId);
        if (!preparation.hasWorkbook()) return ResponseEntity.notFound().build();
        String filename = preparation.getWorkbookFilename() == null ? "lesson-workbook.pdf" : preparation.getWorkbookFilename();
        return pdf(filename, preparation.getWorkbookPdf());
    }

    @PostMapping(value = "/lesson-preparations/{eventId}/answers", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public LessonPreparationResponse uploadAnswers(@PathVariable UUID teacherId,
                                                   @PathVariable String eventId,
                                                   @RequestParam("file") MultipartFile file) throws Exception {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        requireLesson(teacher, eventId);
        return preparationService.uploadAnswers(teacher, eventId, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/lesson-preparations/{eventId}/answers")
    public ResponseEntity<byte[]> answers(@PathVariable UUID teacherId,
                                          @PathVariable String eventId) {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        requireLesson(teacher, eventId);
        LessonPreparation preparation = preparationService.require(teacher, eventId);
        if (!preparation.hasAnswers()) return ResponseEntity.notFound().build();
        String filename = preparation.getAnswersFilename() == null ? "lesson-answers.pdf" : preparation.getAnswersFilename();
        return pdf(filename, preparation.getAnswersPdf());
    }

    @PostMapping(value = "/lesson-preparations/{eventId}/homework-series", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> assignHomeworkSeries(
            @PathVariable UUID teacherId,
            @PathVariable String eventId,
            @RequestParam LocalDate startDate,
            @RequestParam int days,
            @RequestParam("files") List<MultipartFile> files) throws Exception {
        AuthenticatedUser teacher = teacherPrincipal(teacherId);
        GroupLessonResponse lesson = requireLesson(teacher, eventId);
        if (lesson.groupId() != null) {
            return homeworkSeriesService.assignUploadedSeries(
                    teacher, "group", lesson.groupId(), startDate, days, files);
        }
        if (lesson.studentId() != null) {
            return homeworkSeriesService.assignUploadedSeries(
                    teacher, "student", lesson.studentId(), startDate, days, files);
        }
        throw new IllegalArgumentException("Lesson must be linked to a group or student before assigning homework");
    }

    private AuthenticatedUser teacherPrincipal(UUID teacherId) {
        User teacher = userRepository.findById(teacherId)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
        return new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
    }

    private GroupLessonResponse requireLesson(AuthenticatedUser teacher, String eventId) {
        return lessonService.listGroupLessons(teacher).stream()
                .filter(lesson -> lesson.eventId().equals(eventId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Lesson event was not found for this teacher"));
    }

    private ResponseEntity<byte[]> pdf(String filename, byte[] body) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename.replace("\"", "") + "\"")
                .body(body);
    }
}
