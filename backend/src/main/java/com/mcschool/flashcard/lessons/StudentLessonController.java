package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.StudentLessonResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/student/lessons")
@PreAuthorize("hasRole('STUDENT')")
public class StudentLessonController {

    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationRepository preparationRepository;

    public StudentLessonController(
            GoogleCalendarLessonService lessonService,
            LessonPreparationRepository preparationRepository) {
        this.lessonService = lessonService;
        this.preparationRepository = preparationRepository;
    }

    @GetMapping
    public List<StudentLessonResponse> lessons(@AuthenticationPrincipal AuthenticatedUser student) {
        UUID teacherId = lessonService.teacherIdForStudent(student);
        return lessonService.listStudentLessons(student).stream()
                .map(lesson -> toStudentResponse(teacherId, lesson))
                .toList();
    }

    @GetMapping("/{eventId}/shared-document")
    public ResponseEntity<byte[]> sharedDocument(
            @AuthenticationPrincipal AuthenticatedUser student,
            @PathVariable String eventId) {
        GroupLessonResponse lesson = requireStudentLesson(student, eventId);
        UUID teacherId = lessonService.teacherIdForStudent(student);
        LessonPreparation preparation = preparationRepository.findByTeacherIdAndEventId(teacherId, lesson.eventId())
                .orElse(null);
        if (preparation == null || !preparation.hasWorkbook()) {
            return ResponseEntity.notFound().build();
        }

        String filename = preparation.getWorkbookFilename() == null
                ? "lesson-shared-document.pdf"
                : preparation.getWorkbookFilename()
                        .replaceAll("[\\r\\n\\x00-\\x1F\\x7F]", "_")
                        .replace('/', '_')
                        .replace('\\\\', '_');

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline()
                                .filename(filename, StandardCharsets.UTF_8)
                                .build()
                                .toString())
                .body(preparation.getWorkbookPdf());
    }

    private GroupLessonResponse requireStudentLesson(AuthenticatedUser student, String eventId) {
        return lessonService.listStudentLessons(student).stream()
                .filter(lesson -> lesson.eventId().equals(eventId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Lesson is not available for this student"));
    }

    private StudentLessonResponse toStudentResponse(UUID teacherId, GroupLessonResponse lesson) {
        LessonPreparation preparation = preparationRepository
                .findByTeacherIdAndEventId(teacherId, lesson.eventId())
                .orElse(null);
        return new StudentLessonResponse(
                lesson.eventId(),
                lesson.title(),
                lesson.groupName(),
                lesson.startsAt(),
                lesson.endsAt(),
                sanitizeMeetUrl(lesson.meetUrl()),
                preparation != null && preparation.hasWorkbook(),
                preparation != null && preparation.hasWorkbook() ? preparation.getWorkbookFilename() : null
        );
    }

    private String sanitizeMeetUrl(String url) {
        if (url == null || url.isBlank()) return null;
        return url
                .replaceAll("([?&])authuser=[^&]*&?", "$1")
                .replace("?&", "?")
                .replaceAll("[?&]$", "");
    }
}
