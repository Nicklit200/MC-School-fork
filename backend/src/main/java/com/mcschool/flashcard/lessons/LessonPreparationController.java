package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/lesson-preparations")
@PreAuthorize("hasRole('TEACHER')")
public class LessonPreparationController {
    private final LessonPreparationService service;
    private final GoogleCalendarLessonService lessonService;
    private final McpHomeworkSeriesService homeworkSeriesService;

    public LessonPreparationController(
            LessonPreparationService service,
            GoogleCalendarLessonService lessonService,
            McpHomeworkSeriesService homeworkSeriesService) {
        this.service = service;
        this.lessonService = lessonService;
        this.homeworkSeriesService = homeworkSeriesService;
    }

    @GetMapping("/{eventId}")
    public LessonPreparationResponse get(@AuthenticationPrincipal AuthenticatedUser teacher,
                                         @PathVariable String eventId) {
        return service.getOrCreate(teacher, eventId);
    }

    @PutMapping("/{eventId}")
    public LessonPreparationResponse update(@AuthenticationPrincipal AuthenticatedUser teacher,
                                            @PathVariable String eventId,
                                            @RequestBody UpdateLessonPreparationRequest request) {
        return service.update(teacher, eventId, request);
    }

    @PostMapping(value = "/{eventId}/workbook", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public LessonPreparationResponse uploadWorkbook(@AuthenticationPrincipal AuthenticatedUser teacher,
                                                    @PathVariable String eventId,
                                                    @RequestParam("file") MultipartFile file) throws Exception {
        return service.uploadWorkbook(teacher, eventId, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/{eventId}/workbook")
    public ResponseEntity<byte[]> workbook(@AuthenticationPrincipal AuthenticatedUser teacher,
                                           @PathVariable String eventId) {
        LessonPreparation preparation = service.require(teacher, eventId);
        if (!preparation.hasWorkbook()) return ResponseEntity.notFound().build();
        String filename = preparation.getWorkbookFilename() == null ? "lesson-workbook.pdf" : preparation.getWorkbookFilename();
        return pdf(filename, preparation.getWorkbookPdf());
    }

    @PostMapping(value = "/{eventId}/answers", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public LessonPreparationResponse uploadAnswers(@AuthenticationPrincipal AuthenticatedUser teacher,
                                                   @PathVariable String eventId,
                                                   @RequestParam("file") MultipartFile file) throws Exception {
        return service.uploadAnswers(teacher, eventId, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/{eventId}/answers")
    public ResponseEntity<byte[]> answers(@AuthenticationPrincipal AuthenticatedUser teacher,
                                          @PathVariable String eventId) {
        LessonPreparation preparation = service.require(teacher, eventId);
        if (!preparation.hasAnswers()) return ResponseEntity.notFound().build();
        String filename = preparation.getAnswersFilename() == null ? "lesson-answers.pdf" : preparation.getAnswersFilename();
        return pdf(filename, preparation.getAnswersPdf());
    }

    @PostMapping(value = "/{eventId}/homework-series", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> assignHomeworkSeries(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable String eventId,
            @RequestParam LocalDate startDate,
            @RequestParam int days,
            @RequestParam("files") List<MultipartFile> files) throws Exception {
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

    private GroupLessonResponse requireLesson(AuthenticatedUser teacher, String eventId) {
        return lessonService.listGroupLessons(teacher).stream()
                .filter(lesson -> lesson.eventId().equals(eventId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Lesson event was not found"));
    }

    private ResponseEntity<byte[]> pdf(String filename, byte[] body) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename.replace("\"", "") + "\"")
                .body(body);
    }
}
