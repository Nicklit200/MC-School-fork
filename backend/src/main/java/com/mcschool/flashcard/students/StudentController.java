package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.drive.GoogleDriveTestService;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.reviewhistory.dto.DailyReviewHistoryResponse;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.PilotDueCardResponse;
import com.mcschool.flashcard.students.dto.StudentListResponse;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.students.dto.TestReviewReminderResponse;
import com.mcschool.flashcard.students.dto.UpdateStudentDriveFolderRequest;
import jakarta.validation.Valid;
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

    private final StudentService studentService;
    private final DailyReviewHistoryService historyService;
    private final GoogleDriveTestService googleDriveTestService;

    public StudentController(StudentService studentService,
                             DailyReviewHistoryService historyService,
                             GoogleDriveTestService googleDriveTestService) {
        this.studentService = studentService;
        this.historyService = historyService;
        this.googleDriveTestService = googleDriveTestService;
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

    @PutMapping("/{studentId}/drive-folder")
    public StudentListResponse updateDriveFolder(@AuthenticationPrincipal AuthenticatedUser caller,
                                                 @PathVariable UUID studentId,
                                                 @Valid @RequestBody UpdateStudentDriveFolderRequest request) {
        return studentService.updateGoogleDriveFolder(caller, studentId, request);
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
