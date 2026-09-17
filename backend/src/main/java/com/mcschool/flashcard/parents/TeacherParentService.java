package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.security.SecureRandom;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeacherParentService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public TeacherParentService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public List<ParentAccountResponse> list(AuthenticatedUser teacher) {
        requireTeacherRole(teacher);
        Map<UUID, User> parents = new LinkedHashMap<>();

        userRepository.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(teacher.id(), Role.PARENT)
                .forEach(parent -> parents.put(parent.getId(), parent));

        // Include legacy parent accounts that were created through the old email-invitation flow.
        for (User student : ownedStudents(teacher.id())) {
            User parent = student.getParent();
            if (parent != null && !parent.isArchived()) {
                parents.put(parent.getId(), parent);
                if (parent.getTeacher() == null) {
                    parent.assignParentOwner(student.getTeacher());
                }
            }
        }

        return parents.values().stream()
                .sorted(Comparator.comparing(User::getFullName, String.CASE_INSENSITIVE_ORDER))
                .map(parent -> toResponse(parent, teacher.id()))
                .toList();
    }

    @Transactional
    public ParentCredentialsResponse create(AuthenticatedUser teacher, CreateParentAccountRequest request) {
        requireTeacherRole(teacher);
        User teacherEntity = requireTeacher(teacher.id());
        String username = generateUsername(request.fullName());
        String temporaryPassword = generatePassword();
        User parent = User.activeParent(
                request.fullName().trim(),
                username,
                passwordEncoder.encode(temporaryPassword),
                teacherEntity);
        userRepository.save(parent);
        return new ParentCredentialsResponse(toResponse(parent, teacher.id()), temporaryPassword);
    }

    @Transactional
    public ParentAccountResponse linkStudent(AuthenticatedUser teacher, UUID parentId, UUID studentId) {
        requireTeacherRole(teacher);
        User parent = requireManagedParent(teacher.id(), parentId);
        User student = requireOwnedStudent(teacher.id(), studentId);
        if (parent.getTeacher() == null) {
            parent.assignParentOwner(student.getTeacher());
        }
        student.linkParent(parent);
        userRepository.save(student);
        return toResponse(parent, teacher.id());
    }

    @Transactional
    public ParentCredentialsResponse resetPassword(AuthenticatedUser teacher, UUID parentId) {
        requireTeacherRole(teacher);
        User parent = requireManagedParent(teacher.id(), parentId);
        if (parent.getTeacher() == null) {
            parent.assignParentOwner(requireTeacher(teacher.id()));
        }
        String username = parent.getUsername();
        if (username == null || username.isBlank()) {
            username = generateUsername(parent.getFullName());
        }
        String temporaryPassword = generatePassword();
        parent.setParentSchoolCredentials(username, passwordEncoder.encode(temporaryPassword));
        userRepository.save(parent);
        return new ParentCredentialsResponse(toResponse(parent, teacher.id()), temporaryPassword);
    }

    private User requireManagedParent(UUID teacherId, UUID parentId) {
        User parent = userRepository.findById(parentId)
                .filter(user -> user.getRole() == Role.PARENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Parent account not found"));

        boolean owned = parent.getTeacher() != null && parent.getTeacher().getId().equals(teacherId);
        boolean linkedToOwnedStudent = userRepository.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parentId).stream()
                .anyMatch(student -> student.getRole() == Role.STUDENT
                        && student.getTeacher() != null
                        && student.getTeacher().getId().equals(teacherId));
        if (!owned && !linkedToOwnedStudent) {
            throw new ResourceNotFoundException("Parent account not found");
        }
        return parent;
    }

    private User requireOwnedStudent(UUID teacherId, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }

    private User requireTeacher(UUID teacherId) {
        return userRepository.findById(teacherId)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account not found"));
    }

    private List<User> ownedStudents(UUID teacherId) {
        return userRepository.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(teacherId, Role.STUDENT);
    }

    private ParentAccountResponse toResponse(User parent, UUID teacherId) {
        List<ParentAccountResponse.Child> children = userRepository
                .findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.getId()).stream()
                .filter(student -> student.getRole() == Role.STUDENT)
                .filter(student -> student.getTeacher() != null && student.getTeacher().getId().equals(teacherId))
                .map(student -> new ParentAccountResponse.Child(student.getId(), student.getFullName()))
                .toList();
        return new ParentAccountResponse(
                parent.getId(),
                parent.getFullName(),
                parent.getUsername(),
                parent.getEmail(),
                parent.getStatus(),
                children);
    }

    private String generateUsername(String fullName) {
        String base = usernameBase(fullName);
        for (int attempt = 0; attempt < 2000; attempt++) {
            String candidate = base + (100 + RANDOM.nextInt(900));
            if (!userRepository.existsByUsernameIgnoreCase(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not generate a unique parent username");
    }

    private String generatePassword() {
        StringBuilder password = new StringBuilder(10);
        for (int i = 0; i < 10; i++) {
            password.append(PASSWORD_ALPHABET.charAt(RANDOM.nextInt(PASSWORD_ALPHABET.length())));
        }
        return password.toString();
    }

    private static String usernameBase(String fullName) {
        String first = fullName == null ? "parent" : fullName.trim().split("\\s+")[0];
        String cleaned = first.replaceAll("[^\\p{L}\\p{N}]", "");
        if (cleaned.isBlank()) cleaned = "parent";
        if (cleaned.length() > 40) cleaned = cleaned.substring(0, 40);
        return cleaned;
    }

    private static void requireTeacherRole(AuthenticatedUser teacher) {
        if (teacher.role() != Role.TEACHER) {
            throw new IllegalStateException("Teacher role required");
        }
    }
}
