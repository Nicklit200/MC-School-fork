package com.mcschool.flashcard.users;

import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.dto.AssignStudentTeacherRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/admin/accounts")
@PreAuthorize("hasRole('ADMIN')")
public class AdminAccountController {

    private final UserRepository userRepository;

    public AdminAccountController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping
    public List<AdminAccountResponse> listAccounts(@RequestParam Role role) {
        if (role != Role.STUDENT && role != Role.PARENT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Only STUDENT and PARENT accounts are available here");
        }
        return userRepository.findAllByRoleOrderByFullNameAsc(role).stream()
                .filter(user -> !user.isArchived())
                .map(AdminAccountResponse::from)
                .toList();
    }

    @PutMapping("/{studentId}/teacher")
    @Transactional
    public AdminAccountResponse assignStudentTeacher(
            @PathVariable UUID studentId,
            @Valid @RequestBody AssignStudentTeacherRequest request) {
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        User teacher = userRepository.findById(request.teacherId())
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Active teacher not found"));

        student.reassignTeacher(teacher);
        return AdminAccountResponse.from(student);
    }
}
