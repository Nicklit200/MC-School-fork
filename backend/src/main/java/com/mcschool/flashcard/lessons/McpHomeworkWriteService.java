package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkPdfService;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.homeworks.HomeworkService;
import com.mcschool.flashcard.homeworks.HomeworkStats;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** Explicit write operations for existing homework exposed through the Mindcrafti MCP connector. */
@Service
public class McpHomeworkWriteService {

    private final HomeworkRepository homeworkRepository;
    private final HomeworkPdfService homeworkPdfService;
    private final HomeworkService homeworkService;

    public McpHomeworkWriteService(
            HomeworkRepository homeworkRepository,
            HomeworkPdfService homeworkPdfService,
            HomeworkService homeworkService) {
        this.homeworkRepository = homeworkRepository;
        this.homeworkPdfService = homeworkPdfService;
        this.homeworkService = homeworkService;
    }

    @Transactional
    public Map<String, Object> replaceHomework(
            User actor,
            boolean adminLike,
            UUID homeworkId,
            String filename,
            byte[] pdf) {
        Homework homework = requireAccessibleHomework(actor, adminLike, homeworkId);
        if (!homework.hasWorksheet()) {
            throw new IllegalArgumentException("This homework does not have an assigned PDF to replace");
        }
        if (homework.isSubmitted()) {
            throw new IllegalArgumentException("Submitted homework cannot be replaced because it would erase the student's submission");
        }

        AuthenticatedUser teacher = teacherPrincipal(homework);
        String effectiveFilename = effectiveFilename(homework, filename);
        homeworkPdfService.uploadWorksheet(
                teacher,
                homeworkId,
                new ByteArrayPdfMultipartFile(effectiveFilename, pdf));

        Homework updated = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new IllegalArgumentException("Homework not found"));
        return result("replaced", updated);
    }

    @Transactional
    public Map<String, Object> updateHomework(
            User actor,
            boolean adminLike,
            UUID homeworkId,
            LocalDate newStartDate,
            String filename,
            byte[] pdf) {
        Homework homework = requireAccessibleHomework(actor, adminLike, homeworkId);
        if (homework.isSubmitted()) {
            throw new IllegalArgumentException("Submitted homework cannot be updated because it would modify an already completed assignment");
        }
        if (newStartDate == null && pdf == null) {
            throw new IllegalArgumentException("Provide at least one change: newStartDate or pdfBase64");
        }
        if (pdf == null && filename != null && !filename.isBlank()) {
            throw new IllegalArgumentException("filename can be changed only together with pdfBase64");
        }

        if (newStartDate != null && !newStartDate.equals(homework.getStartDate())) {
            HomeworkStats stats = stats(homework);
            if (stats != null && stats.totalCards() > 0) {
                throw new IllegalArgumentException("Homework containing cards cannot be rescheduled");
            }

            boolean duplicateDate = homeworkRepository
                    .findAllByStudentIdOrderByStartDateDescCreatedAtDesc(homework.getStudent().getId()).stream()
                    .anyMatch(other -> !other.getId().equals(homeworkId) && newStartDate.equals(other.getStartDate()));
            if (duplicateDate) {
                throw new IllegalArgumentException("The student already has another homework bucket on " + newStartDate);
            }
            homework.reschedule(newStartDate);
        }

        if (pdf != null) {
            AuthenticatedUser teacher = teacherPrincipal(homework);
            String effectiveFilename = effectiveFilename(homework, filename);
            homeworkPdfService.uploadWorksheet(
                    teacher,
                    homeworkId,
                    new ByteArrayPdfMultipartFile(effectiveFilename, pdf));
        }

        Homework updated = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new IllegalArgumentException("Homework not found"));
        return result("updated", updated);
    }

    @Transactional
    public Map<String, Object> deleteHomework(
            User actor,
            boolean adminLike,
            UUID homeworkId,
            boolean confirm) {
        if (!confirm) {
            throw new IllegalArgumentException("confirm must be true to permanently delete homework");
        }

        Homework homework = requireAccessibleHomework(actor, adminLike, homeworkId);
        Map<String, Object> beforeDelete = result("deleted", homework);
        homeworkService.deleteHomework(teacherPrincipal(homework), homeworkId);

        beforeDelete.put("deleted", true);
        beforeDelete.put("warning", "The homework record and stored PDFs were permanently deleted.");
        return beforeDelete;
    }

    private Homework requireAccessibleHomework(User actor, boolean adminLike, UUID homeworkId) {
        Homework homework = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new IllegalArgumentException("Homework not found"));
        User student = homework.getStudent();
        if (student == null || student.isArchived()) {
            throw new IllegalArgumentException("Student not found");
        }

        if (adminLike || (actor != null && actor.getRole() == Role.ADMIN)) {
            return homework;
        }

        User teacher = student.getTeacher();
        if (actor == null || actor.getRole() != Role.TEACHER || teacher == null
                || !actor.getId().equals(teacher.getId())) {
            throw new IllegalArgumentException("Teachers can modify only homework belonging to their own students");
        }
        return homework;
    }

    private AuthenticatedUser teacherPrincipal(Homework homework) {
        User teacher = homework.getStudent().getTeacher();
        if (teacher == null || teacher.isArchived() || teacher.getRole() != Role.TEACHER) {
            throw new IllegalArgumentException("The homework student does not have an active teacher");
        }
        return new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
    }

    private HomeworkStats stats(Homework homework) {
        return homeworkRepository.statsByStudentId(homework.getStudent().getId()).stream()
                .filter(item -> item.homeworkId().equals(homework.getId()))
                .findFirst()
                .orElse(null);
    }

    private Map<String, Object> result(String action, Homework homework) {
        HomeworkStats stats = stats(homework);
        User student = homework.getStudent();
        User teacher = student.getTeacher();

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("action", action);
        row.put("homeworkId", homework.getId().toString());
        row.put("studentId", student.getId().toString());
        row.put("studentName", student.getFullName());
        row.put("teacherId", teacher == null ? null : teacher.getId().toString());
        row.put("teacherName", teacher == null ? null : teacher.getFullName());
        row.put("assignedDate", homework.getStartDate().toString());
        row.put("worksheetFilename", homework.getWorksheetFilename());
        row.put("hasWorksheet", homework.hasWorksheet());
        row.put("submitted", homework.isSubmitted());
        row.put("submittedAt", homework.getSubmittedAt() == null ? null : homework.getSubmittedAt().toString());
        row.put("totalCards", stats == null ? 0 : stats.totalCards());
        row.put("source", "mindcrafti_database");
        return row;
    }

    private String effectiveFilename(Homework homework, String requested) {
        String value = requested == null ? "" : requested.trim();
        if (value.isBlank()) value = homework.getWorksheetFilename();
        if (value == null || value.isBlank()) value = "homework.pdf";
        value = value.replace("/", "_").replace("\\", "_").replace("\"", "");
        if (!value.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")) value += ".pdf";
        return value;
    }

    private static final class ByteArrayPdfMultipartFile implements MultipartFile {
        private final String filename;
        private final byte[] bytes;

        private ByteArrayPdfMultipartFile(String filename, byte[] bytes) {
            if (bytes == null || bytes.length == 0) throw new IllegalArgumentException("PDF is empty");
            this.filename = filename;
            this.bytes = bytes;
        }

        @Override
        public String getName() {
            return "file";
        }

        @Override
        public String getOriginalFilename() {
            return filename;
        }

        @Override
        public String getContentType() {
            return "application/pdf";
        }

        @Override
        public boolean isEmpty() {
            return bytes.length == 0;
        }

        @Override
        public long getSize() {
            return bytes.length;
        }

        @Override
        public byte[] getBytes() {
            return bytes;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(bytes);
        }

        @Override
        public void transferTo(File dest) throws IOException {
            Files.write(dest.toPath(), bytes);
        }
    }
}
