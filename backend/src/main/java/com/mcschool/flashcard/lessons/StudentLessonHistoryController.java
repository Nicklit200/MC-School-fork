package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDetail;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDocument;
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
@RequestMapping("/api/v1/teacher/students/{studentId}/lesson-history")
@PreAuthorize("hasRole('TEACHER')")
public class StudentLessonHistoryController {

    private final StudentLessonHistoryService service;

    public StudentLessonHistoryController(StudentLessonHistoryService service) {
        this.service = service;
    }

    @GetMapping
    public List<StudentLessonHistoryItem> list(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID studentId) {
        return service.list(teacher, studentId);
    }

    @GetMapping("/{sourceTeacherId}/{eventId}")
    public StudentLessonHistoryDetail detail(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID studentId,
            @PathVariable UUID sourceTeacherId,
            @PathVariable String eventId) {
        return service.detail(teacher, studentId, sourceTeacherId, eventId);
    }

    @GetMapping("/{sourceTeacherId}/{eventId}/completed-documents/list")
    public List<StudentLessonHistoryDocument> completedDocuments(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID studentId,
            @PathVariable UUID sourceTeacherId,
            @PathVariable String eventId) {
        return service.completedDocuments(teacher, studentId, sourceTeacherId, eventId);
    }

    @GetMapping("/{sourceTeacherId}/{eventId}/completed-documents/{documentId}")
    public ResponseEntity<byte[]> completedDocument(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID studentId,
            @PathVariable UUID sourceTeacherId,
            @PathVariable String eventId,
            @PathVariable UUID documentId) {
        StudentLessonHistoryService.PdfFile file =
                service.completedDocument(teacher, studentId, sourceTeacherId, eventId, documentId);
        if (file == null) return ResponseEntity.notFound().build();
        String filename = file.filename()
                .replaceAll("[\\r\\n\\x00-\\x1F\\x7F]", "_")
                .replace('/', '_')
                .replace('\\', '_')
                .replace('"', '_');
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline().filename(filename, StandardCharsets.UTF_8).build().toString())
                .body(file.bytes());
    }

    @GetMapping("/{sourceTeacherId}/{eventId}/{documentKind}")
    public ResponseEntity<byte[]> document(
            @AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID studentId,
            @PathVariable UUID sourceTeacherId,
            @PathVariable String eventId,
            @PathVariable String documentKind) {
        StudentLessonHistoryService.PdfFile file =
                service.document(teacher, studentId, sourceTeacherId, eventId, documentKind);
        if (file == null) return ResponseEntity.notFound().build();
        String filename = file.filename()
                .replaceAll("[\\r\\n\\x00-\\x1F\\x7F]", "_")
                .replace('/', '_')
                .replace('\\', '_')
                .replace('"', '_');
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline().filename(filename, StandardCharsets.UTF_8).build().toString())
                .body(file.bytes());
    }
}
