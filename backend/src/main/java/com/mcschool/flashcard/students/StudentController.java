package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.students.dto.StudentReviewSessionResponse;
import com.mcschool.flashcard.users.UserResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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

    public StudentController(StudentService studentService) {
        this.studentService = studentService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public StudentInvitationResponse createStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                                                   @Valid @RequestBody CreateStudentRequest request) {
        return studentService.createStudent(caller, request);
    }

    @GetMapping
    public List<UserResponse> listStudents(@AuthenticationPrincipal AuthenticatedUser caller) {
        return studentService.listStudents(caller);
    }

    @GetMapping("/{studentId}/review-history")
    public List<StudentReviewSessionResponse> reviewHistory(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID studentId) {
        return studentService.reviewHistory(caller, studentId);
    }
}
