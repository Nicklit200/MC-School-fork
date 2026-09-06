package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.students.dto.StudentListResponse;
import com.mcschool.flashcard.students.dto.UpdateStudentChatGptProjectUrlRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/students")
@PreAuthorize("hasRole('TEACHER')")
public class StudentChatGptProjectController {

    private final UserRepository userRepository;

    public StudentChatGptProjectController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @PutMapping("/{studentId}/chatgpt-project")
    @Transactional
    public StudentListResponse updateChatGptProject(@AuthenticationPrincipal AuthenticatedUser caller,
                                                    @PathVariable UUID studentId,
                                                    @RequestBody UpdateStudentChatGptProjectUrlRequest request) {
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(caller.id()))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        student.changeChatGptProjectUrl(request.chatGptProjectUrl());
        return StudentListResponse.from(student);
    }
}
