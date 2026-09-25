package com.mcschool.flashcard.teachers;

import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.teachers.dto.CreateTeacherRequest;
import com.mcschool.flashcard.teachers.dto.UpdateTeacherTrialTranscriptFolderRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeacherService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public TeacherService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public UserResponse createTeacher(CreateTeacherRequest request) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        String username = request.username().trim();

        if (userRepository.existsByEmail(email)) {
            throw new ConflictException("An account with this email already exists");
        }
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new ConflictException("An account with this login already exists");
        }

        User teacher = userRepository.save(User.activeTeacher(
                request.fullName().trim(),
                email,
                username,
                passwordEncoder.encode(request.password())));
        return UserResponse.from(teacher);
    }

    @Transactional(readOnly = true)
    public List<UserResponse> listTeachers() {
        return userRepository.findAllByRoleOrderByFullNameAsc(Role.TEACHER).stream()
                .filter(user -> !user.isArchived())
                .map(UserResponse::from)
                .toList();
    }

    @Transactional
    public void deleteTeacher(UUID teacherId) {
        User teacher = userRepository.findById(teacherId)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher not found"));
        teacher.archive();
    }

    @Transactional
    public UserResponse updateTrialTranscriptFolder(UUID teacherId, UpdateTeacherTrialTranscriptFolderRequest request) {
        User teacher = userRepository.findById(teacherId)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher not found"));
        teacher.changeGoogleDriveTrialTranscriptFolderId(request.folderId());
        return UserResponse.from(teacher);
    }
}
