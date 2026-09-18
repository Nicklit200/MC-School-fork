package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.students.dto.StudentListResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Pauses and resumes a student without deleting any history.
 */
@RestController
@RequestMapping("/api/v1/students")
@PreAuthorize("hasRole('TEACHER')")
public class StudentStatusController {

    private final UserRepository userRepository;

    public StudentStatusController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @PutMapping("/{studentId}/deactivate")
    public StudentListResponse deactivate(@AuthenticationPrincipal AuthenticatedUser teacher,
                                          @PathVariable UUID studentId) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.deactivateManagedStudent();
        return StudentListResponse.from(student);
    }

    @PutMapping("/{studentId}/reactivate")
    public StudentListResponse reactivate(@AuthenticationPrincipal AuthenticatedUser teacher,
                                          @PathVariable UUID studentId) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.reactivateManagedStudent();
        return StudentListResponse.from(student);
    }

    private User requireOwnedStudent(UUID teacherId, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }
}
