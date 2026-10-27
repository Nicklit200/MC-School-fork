package com.mcschool.flashcard.users;

import com.mcschool.flashcard.users.dto.AssignStudentTeacherRequest;
import com.mcschool.flashcard.users.dto.TransferStudentsRequest;
import com.mcschool.flashcard.users.dto.TransferStudentsResponse;
import com.mcschool.flashcard.users.dto.StudentTransferResponse;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.TeacherTransferService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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
    private final TeacherTransferService transferService;

    public AdminAccountController(UserRepository userRepository, TeacherTransferService transferService) {
        this.userRepository = userRepository;
        this.transferService = transferService;
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

    @GetMapping("/teacher-options")
    public List<TeacherAssignmentOption> teacherOptions() {
        return userRepository.findAllByRoleOrderByFullNameAsc(Role.TEACHER).stream()
                .map(TeacherAssignmentOption::from)
                .toList();
    }

    @PutMapping("/{studentId}/teacher")
    public StudentTransferResponse assignStudentTeacher(
            @PathVariable UUID studentId,
            @Valid @RequestBody AssignStudentTeacherRequest request) {
        return transferService.transferStudent(studentId, request.teacherId());
    }

    @PostMapping("/transfer-students")
    public TransferStudentsResponse transferStudents(
            @Valid @RequestBody TransferStudentsRequest request) {
        return transferService.transferAllStudents(request.fromTeacherId(), request.toTeacherId());
    }
}
