package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.drive.GoogleDriveTestService;
import com.mcschool.flashcard.drive.dto.DriveUploadResponse;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.reviewhistory.dto.DailyReviewHistoryResponse;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.PilotDueCardResponse;
import com.mcschool.flashcard.students.dto.StudentListResponse;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.students.dto.TestReviewReminderResponse;
import com.mcschool.flashcard.students.dto.UpdateStudentDriveFolderRequest;
import com.mcschool.flashcard.students.dto.UpdateStudentHomeworkDriveFolderRequest;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Student account management by the owning teacher. */
@RestController
@RequestMapping("/api/v1/students")
@PreAuthorize("hasRole('TEACHER')")
public class StudentController {

    private static final DateTimeFormatter TEST_EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");

    private final StudentService studentService;
    private final DailyReviewHistoryService historyService;
    private final GoogleDriveTestService googleDriveTestService;
    private final GoogleDriveService googleDriveService;

    public StudentController(StudentService studentService,
                             DailyReviewHistoryService historyService,
                             GoogleDriveTestService googleDriveTestService,
                             GoogleDriveService googleDriveService) {
        this.studentService = studentService;
        this.historyService = historyService;
        this.googleDriveTestService = googleDriveTestService;
        this.googleDriveService = googleDriveService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public StudentInvitationResponse createStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                                                   @Valid @RequestBody CreateStudentRequest request) {
        return studentService.createStudent(caller, request);
    }

    @GetMapping
    public List<StudentListResponse> listStudents(@AuthenticationPrincipal AuthenticatedUser caller) {
        return studentService.listStudents(caller);
    }

    @GetMapping("/{studentId}")
    public StudentListResponse getStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                                          @PathVariable UUID studentId) {
        return studentService.getStudent(caller, studentId);
    }

    /** Destination for completed card-session CSV exports. */
    @PutMapping("/{studentId}/drive-folder")
    public StudentListResponse updateDriveFolder(@AuthenticationPrincipal AuthenticatedUser caller,
                                                 @PathVariable UUID studentId,
                                                 @Valid @RequestBody UpdateStudentDriveFolderRequest request) {
        return studentService.updateGoogleDriveFolder(caller, studentId, request);
    }

    /** Destination for PDFs submitted by the student. */
    @PutMapping("/{studentId}/homework-drive-folder")
    public StudentListResponse updateHomeworkDriveFolder(@AuthenticationPrincipal AuthenticatedUser caller,
                                                         @PathVariable UUID studentId,
                                                         @Valid @RequestBody UpdateStudentHomeworkDriveFolderRequest request) {
        return studentService.updateGoogleDriveHomeworkFolder(caller, studentId, request);
    }

    @PostMapping("/{studentId}/drive-folder/test")
    public Map<String, String> testDriveFolder(@AuthenticationPrincipal AuthenticatedUser caller,
                                               @PathVariable UUID studentId) {
        StudentListResponse student = studentService.getStudent(caller, studentId);
        try {
            return googleDriveTestService.testFolder(student.googleDriveFolderUrl());
        } catch (IllegalArgumentException | IllegalStateException ex) {
            return Map.of(
                    "status", "error",
                    "message", safeDriveTestMessage(ex.getMessage())
            );
        }
    }

    @PostMapping("/{studentId}/homework-drive-folder/test")
    public Map<String, String> testHomeworkDriveFolder(@AuthenticationPrincipal AuthenticatedUser caller,
                                                       @PathVariable UUID studentId) {
        StudentListResponse student = studentService.getStudent(caller, studentId);
        try {
            return googleDriveTestService.testFolder(student.googleDriveHomeworkFolderId());
        } catch (IllegalArgumentException | IllegalStateException ex) {
            return Map.of(
                    "status", "error",
                    "message", safeDriveTestMessage(ex.getMessage())
            );
        }
    }

    @PostMapping("/{studentId}/drive-folder/test-export")
    public Map<String, String> testAutomaticExport(@AuthenticationPrincipal AuthenticatedUser caller,
                                                   @PathVariable UUID studentId) {
        StudentListResponse student = studentService.getStudent(caller, studentId);
        String folderId = student.googleDriveFolderUrl();
        if (folderId == null || folderId.isBlank()) {
            return Map.of("status", "error", "message", "Сначала выберите папку для карточек Google Drive");
        }

        try {
            String csv = "\uFEFFStudent;Session type;Total;Correct first try;Wrong first try\r\n"
                    + csvCell(student.fullName()) + ";TEST;5;4;1\r\n\r\n"
                    + "Question;Student answer;Correct answer;Result\r\n"
                    + "2 + 2;4;4;CORRECT\r\n"
                    + "5 x 3;12;15;WRONG\r\n"
                    + "10 - 3;7;7;CORRECT\r\n";

            String fileName = safeFileName(student.fullName()) + "_"
                    + ZonedDateTime.now().format(TEST_EXPORT_TIME)
                    + "_TEST_cards.csv";
            DriveUploadResponse uploaded = googleDriveService.uploadBytes(
                    folderId,
                    fileName,
                    "text/csv; charset=utf-8",
                    csv.getBytes(StandardCharsets.UTF_8)
            );
            return Map.of(
                    "status", "ok",
                    "fileName", uploaded.name(),
                    "fileUrl", uploaded.webViewLink() == null ? "" : uploaded.webViewLink()
            );
        } catch (RuntimeException ex) {
            return Map.of(
                    "status", "error",
                    "message", "Не удалось создать тестовую таблицу: " + ex.getMessage()
            );
        }
    }

    private String csvCell(String value) {
        if (value == null) {
            return "\"\"";
        }
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private String safeFileName(String value) {
        if (value == null || value.isBlank()) {
            return "student";
        }
        String cleaned = value.trim().replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\s+", "_");
        return cleaned.isBlank() ? "student" : cleaned;
    }

    private String safeDriveTestMessage(String message) {
        if (message == null || message.isBlank()) {
            return "Не удалось проверить Google Drive";
        }
        if (message.contains("GOOGLE_SERVICE_ACCOUNT_JSON is not configured")) {
            return "В Railway не найдена переменная GOOGLE_SERVICE_ACCOUNT_JSON";
        }
        if (message.contains("Invalid Google Drive folder URL")) {
            return "Ссылка на папку Google Drive имеет неверный формат";
        }
        if (message.contains("Google authentication returned HTTP 400")) {
            return "Google не принял JSON-ключ. Проверь, что в Railway вставлен весь JSON-файл целиком";
        }
        if (message.contains("Google authentication returned HTTP 401")) {
            return "Google отклонил ключ сервисного аккаунта";
        }
        if (message.contains("Google Drive returned HTTP 403")) {
            return "Сервисному аккаунту не хватает доступа к этой папке или Shared Drive";
        }
        if (message.contains("Google Drive returned HTTP 404")) {
            return "Папка не найдена или сервисный аккаунт её не видит";
        }
        if (message.startsWith("Google Drive returned HTTP ")) {
            return message;
        }
        return "Ошибка подключения Google Drive: " + message;
    }

    @GetMapping("/{studentId}/review-history")
    public List<DailyReviewHistoryResponse> reviewHistory(@AuthenticationPrincipal AuthenticatedUser caller,
                                                          @PathVariable UUID studentId) {
        return historyService.listForTeacher(caller.id(), studentId);
    }

    @PostMapping("/{studentId}/test-review-reminder")
    public TestReviewReminderResponse testReviewReminder(@AuthenticationPrincipal AuthenticatedUser caller,
                                                         @PathVariable UUID studentId) {
        return studentService.sendTestReviewReminder(caller, studentId);
    }

    @PostMapping("/{studentId}/make-one-card-due-today")
    public PilotDueCardResponse makeOneCardDueToday(@AuthenticationPrincipal AuthenticatedUser caller,
                                                    @PathVariable UUID studentId) {
        return studentService.makeOneCardDueToday(caller, studentId);
    }

    @DeleteMapping("/{studentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                              @PathVariable UUID studentId) {
        studentService.deleteStudent(caller, studentId);
    }
}
