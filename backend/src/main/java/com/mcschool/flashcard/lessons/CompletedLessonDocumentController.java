package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import com.mcschool.flashcard.liveclasses.PersonalBoard;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Completed lesson PDFs, one shared board and one personal board per student. */
@RestController
@RequestMapping("/api/v1/lesson-preparations/{eventId}/completed-documents")
@PreAuthorize("hasRole('TEACHER')")
public class CompletedLessonDocumentController {
    private final JdbcTemplate jdbc;
    private final LessonPreparationService lessons;
    private final OnlineClassAccessService classAccess;
    private final PersonalLessonWorkbookService personalWorkbooks;

    public CompletedLessonDocumentController(JdbcTemplate jdbc, LessonPreparationService lessons,
            OnlineClassAccessService classAccess, PersonalLessonWorkbookService personalWorkbooks) {
        this.jdbc = jdbc;
        this.lessons = lessons;
        this.classAccess = classAccess;
        this.personalWorkbooks = personalWorkbooks;
    }

    public record DocumentInfo(UUID id, UUID classId, String boardId, String filename, String savedAt) {}

    @GetMapping
    public List<DocumentInfo> list(@AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable String eventId) {
        lessons.require(teacher, eventId);
        return jdbc.query("""
            SELECT id, class_id, board_id, filename, updated_at
            FROM completed_lesson_documents
            WHERE teacher_id = ? AND event_id = ?
            ORDER BY updated_at DESC
            """, (rs, n) -> new DocumentInfo(rs.getObject("id", UUID.class),
                rs.getObject("class_id", UUID.class), rs.getString("board_id"),
                rs.getString("filename"), rs.getTimestamp("updated_at").toInstant().toString()),
            teacher.id(), eventId);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public DocumentInfo save(@AuthenticationPrincipal AuthenticatedUser teacher,
                             @PathVariable String eventId,
                             @RequestParam UUID classId,
                             @RequestParam String boardId,
                             @RequestParam("file") MultipartFile file) throws Exception {
        if (!boardId.equals("board-1") && PersonalBoard.ownerOf(boardId).isEmpty())
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "Invalid board");
        if (PersonalBoard.isWorkbook(boardId)) {
            var onlineClass = classAccess.requireHost(teacher, classId);
            if (!eventId.equals(onlineClass.getEventId()) || !personalWorkbooks.enabled(teacher))
                throw new com.mcschool.flashcard.common.ResourceNotFoundException("Personal workbook not found");
            personalWorkbooks.requireClassStudent(onlineClass, PersonalBoard.ownerOf(boardId).orElseThrow());
        }
        if (file.getSize() < 5 || file.getSize() > 25 * 1024 * 1024)
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "PDF size out of range");
        byte[] bytes = file.getBytes();
        if (bytes[0] != '%' || bytes[1] != 'P' || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-')
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "Expected PDF");
        // Prevent saving another teacher's classroom or a foreign event.
        Integer owned = jdbc.queryForObject("""
            SELECT count(*) FROM online_classes WHERE id = ? AND teacher_id = ? AND event_id = ?
            """, Integer.class, classId, teacher.id(), eventId);
        if (owned == null || owned == 0)
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.FORBIDDEN, "Class does not belong to this lesson");
        String filename = boardId.equals("board-1") ? "Общая-доска.pdf"
                : (PersonalBoard.isWorkbook(boardId) ? "Персональный-лист-" : "Ученик-")
                    + PersonalBoard.ownerOf(boardId).orElseThrow() + ".pdf";
        // A lesson worked on blank boards may have no preparation yet. Create
        // its metadata only after the file, board access and exact owned
        // classroom/event binding have all been validated.
        lessons.getOrCreate(teacher, eventId);
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO completed_lesson_documents(id,teacher_id,event_id,class_id,board_id,filename,pdf)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT (teacher_id,event_id,class_id,board_id)
            DO UPDATE SET pdf = EXCLUDED.pdf, filename = EXCLUDED.filename, updated_at = now()
            """, id, teacher.id(), eventId, classId, boardId, filename, bytes);
        return list(teacher, eventId).stream().filter(item -> item.classId().equals(classId) && item.boardId().equals(boardId)).findFirst().orElseThrow();
    }

    /** Manual upload for a finished lesson, independent of a live video room. */
    @PostMapping(value = "/manual", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public DocumentInfo uploadManual(@AuthenticationPrincipal AuthenticatedUser teacher,
                                     @PathVariable String eventId,
                                     @RequestParam(defaultValue = "shared") String target,
                                     @RequestParam(value = "studentId", required = false) UUID studentId,
                                     @RequestParam("file") MultipartFile file) throws Exception {
        lessons.require(teacher, eventId);
        if (!"shared".equals(target) && !"student".equals(target))
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "Invalid target");
        if ("student".equals(target)) {
            if (studentId == null) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "Student required");
            Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM users WHERE id = ? AND teacher_id = ? AND role = 'STUDENT'
                """, Integer.class, studentId, teacher.id());
            if (count == null || count == 0) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.FORBIDDEN, "Student not assigned to teacher");
        }
        if (file.getSize() < 5 || file.getSize() > 25 * 1024 * 1024)
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "PDF size out of range");
        byte[] bytes = file.getBytes();
        if (bytes[0] != '%' || bytes[1] != 'P' || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-')
            throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "Expected PDF");
        String boardId = studentId != null && "student".equals(target) ? "manual-personal-" + studentId : "manual-shared";
        UUID classId = UUID.nameUUIDFromBytes(("manual-lesson:" + teacher.id() + ":" + eventId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String filename = file.getOriginalFilename() == null ? "Пройденный-урок.pdf" : file.getOriginalFilename();
        filename = filename.replaceAll("[\\r\\n\\\\/]", "_");
        if (filename.length() > 255) filename = filename.substring(filename.length() - 255);
        jdbc.update("""
            INSERT INTO completed_lesson_documents(id,teacher_id,event_id,class_id,board_id,filename,pdf)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT (teacher_id,event_id,class_id,board_id)
            DO UPDATE SET pdf = EXCLUDED.pdf, filename = EXCLUDED.filename, updated_at = now()
            """, UUID.randomUUID(), teacher.id(), eventId, classId, boardId, filename, bytes);
        return list(teacher, eventId).stream()
            .filter(item -> item.classId().equals(classId) && item.boardId().equals(boardId))
            .findFirst().orElseThrow();
    }

    @GetMapping("/{documentId}")
    public ResponseEntity<byte[]> download(@AuthenticationPrincipal AuthenticatedUser teacher,
                                            @PathVariable String eventId, @PathVariable UUID documentId) {
        lessons.require(teacher, eventId);
        return jdbc.query("""
            SELECT filename, pdf FROM completed_lesson_documents
            WHERE id = ? AND teacher_id = ? AND event_id = ?
            """, rs -> {
                if (!rs.next()) return ResponseEntity.notFound().build();
                return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"completed-lesson.pdf\"")
                    .body(rs.getBytes("pdf"));
            }, documentId, teacher.id(), eventId);
    }
}
