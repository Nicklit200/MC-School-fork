package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkDeadlinePolicy;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.homeworks.HomeworkStats;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ParentService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardRepository cardRepository;
    private final PasswordEncoder passwordEncoder;
    private final ZoneId zone;

    public ParentService(UserRepository userRepository,
                         HomeworkRepository homeworkRepository,
                         CardRepository cardRepository,
                         PasswordEncoder passwordEncoder,
                         @Value("${app.parent-homework-reminders.zone:Europe/Berlin}") String zone) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.cardRepository = cardRepository;
        this.passwordEncoder = passwordEncoder;
        this.zone = ZoneId.of(zone);
    }

    @Transactional(readOnly = true)
    public List<ParentChildStatusResponse> children(AuthenticatedUser parent) {
        if (parent.role() != Role.PARENT) {
            throw new IllegalStateException("Parent role required");
        }
        LocalDate today = LocalDate.now(zone);
        return userRepository.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.id()).stream()
                .map(student -> toStatus(student, today))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ManagedParentResponse> managedParents(AuthenticatedUser teacher) {
        requireTeacher(teacher);
        return visibleParents(teacher.id()).values().stream()
                .sorted(Comparator.comparing(User::getFullName, String.CASE_INSENSITIVE_ORDER))
                .map(parent -> toManagedParent(parent, teacher.id()))
                .toList();
    }

    @Transactional
    public ManagedParentResponse createParent(AuthenticatedUser teacher, String fullName, String password) {
        requireTeacher(teacher);
        User teacherEntity = userRepository.findById(teacher.id())
                .filter(user -> !user.isArchived() && user.getRole() == Role.TEACHER)
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account not found"));

        String normalizedName = fullName == null ? "" : fullName.trim();
        if (normalizedName.isBlank()) {
            throw new IllegalArgumentException("Parent name is required");
        }
        validatePassword(password);

        String username = generateUsername(normalizedName);
        User parent = User.activeParent(
                normalizedName,
                username,
                passwordEncoder.encode(password),
                teacherEntity);
        userRepository.save(parent);
        return toManagedParent(parent, teacher.id());
    }

    @Transactional
    public ManagedParentResponse linkStudent(AuthenticatedUser teacher, UUID parentId, UUID studentId) {
        requireTeacher(teacher);
        User parent = requireVisibleParent(teacher.id(), parentId);
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.linkParent(parent);
        return toManagedParent(parent, teacher.id());
    }

    @Transactional
    public ManagedParentResponse resetParentPassword(AuthenticatedUser teacher, UUID parentId, String password) {
        requireTeacher(teacher);
        validatePassword(password);
        User parent = requireVisibleParent(teacher.id(), parentId);
        String username = parent.getUsername();
        if (username == null || username.isBlank()) {
            username = generateUsername(parent.getFullName());
        }
        parent.setParentSchoolCredentials(username, passwordEncoder.encode(password));
        return toManagedParent(parent, teacher.id());
    }

    private Map<UUID, User> visibleParents(UUID teacherId) {
        Map<UUID, User> parents = new LinkedHashMap<>();
        for (User user : userRepository.findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacherId)) {
            if (user.getRole() == Role.PARENT) {
                parents.put(user.getId(), user);
            } else if (user.getRole() == Role.STUDENT && user.getParent() != null && !user.getParent().isArchived()) {
                parents.put(user.getParent().getId(), user.getParent());
            }
        }
        return parents;
    }

    private User requireVisibleParent(UUID teacherId, UUID parentId) {
        User parent = userRepository.findById(parentId)
                .filter(user -> user.getRole() == Role.PARENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Parent account not found"));

        boolean directlyManaged = parent.getTeacher() != null && parent.getTeacher().getId().equals(teacherId);
        boolean linkedToOwnedStudent = userRepository.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parentId).stream()
                .anyMatch(student -> student.getTeacher() != null && student.getTeacher().getId().equals(teacherId));
        if (!directlyManaged && !linkedToOwnedStudent) {
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

    private ManagedParentResponse toManagedParent(User parent, UUID teacherId) {
        List<ManagedChildResponse> linkedChildren = userRepository
                .findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.getId()).stream()
                .filter(student -> student.getTeacher() != null && student.getTeacher().getId().equals(teacherId))
                .map(student -> new ManagedChildResponse(student.getId(), student.getFullName()))
                .toList();
        return new ManagedParentResponse(
                parent.getId(),
                parent.getFullName(),
                parent.getEmail(),
                parent.getUsername(),
                parent.getStatus(),
                linkedChildren);
    }

    private String generateUsername(String fullName) {
        String first = fullName.trim().split("\\s+")[0];
        String base = first.replaceAll("[^\\p{L}\\p{N}]", "");
        if (base.isBlank()) {
            base = "parent";
        }
        if (base.length() > 40) {
            base = base.substring(0, 40);
        }
        for (int attempt = 0; attempt < 2000; attempt++) {
            String candidate = base + (100 + RANDOM.nextInt(900));
            if (!userRepository.existsByUsernameIgnoreCase(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not generate a unique parent username");
    }

    private static void validatePassword(String password) {
        if (password == null || password.length() < 6 || password.length() > 100) {
            throw new IllegalArgumentException("Password must contain between 6 and 100 characters");
        }
    }

    private static void requireTeacher(AuthenticatedUser caller) {
        if (caller.role() != Role.TEACHER) {
            throw new IllegalStateException("Teacher role required");
        }
    }

    private ParentChildStatusResponse toStatus(User student, LocalDate today) {
        List<Homework> allHomeworks = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId());
        Map<UUID, HomeworkStats> statsByHomework = homeworkRepository.statsByStudentId(student.getId()).stream()
                .collect(Collectors.toMap(HomeworkStats::homeworkId, Function.identity()));

        List<Homework> todayHomeworks = allHomeworks.stream()
                .filter(Homework::hasWorksheet)
                .filter(homework -> homework.getStartDate().equals(today))
                .toList();
        long completed = todayHomeworks.stream().filter(Homework::isSubmitted).count();
        long open = todayHomeworks.size() - completed;
        long cardsDue = cardRepository.countDueCards(student.getId(), today);

        List<ParentHomeworkStatusResponse> history = allHomeworks.stream()
                .filter(homework -> {
                    HomeworkStats stats = statsByHomework.get(homework.getId());
                    return homework.hasWorksheet() || (stats != null && stats.totalCards() > 0);
                })
                .map(homework -> {
                    HomeworkStats stats = statsByHomework.getOrDefault(
                            homework.getId(),
                            new HomeworkStats(homework.getId(), 0, 0, 0, 0));
                    return new ParentHomeworkStatusResponse(
                            homework.getId(),
                            homework.getStartDate(),
                            homework.hasWorksheet(),
                            homework.getWorksheetFilename(),
                            homework.isSubmitted(),
                            homework.getSubmittedAt(),
                            HomeworkDeadlinePolicy.deadlineAt(homework.getStartDate()),
                            homework.hasWorksheet() && HomeworkDeadlinePolicy.isOverdue(homework),
                            homework.hasWorksheet() && HomeworkDeadlinePolicy.wasSubmittedLate(homework),
                            stats.totalCards(),
                            stats.learned());
                })
                .toList();

        return new ParentChildStatusResponse(
                student.getId(), student.getFullName(), todayHomeworks.size(), completed, open, cardsDue, history);
    }

    public record ManagedChildResponse(UUID id, String fullName) {}

    public record ManagedParentResponse(
            UUID id,
            String fullName,
            String email,
            String username,
            UserStatus status,
            List<ManagedChildResponse> children
    ) {}
}
