package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.CardStatus;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.drive.GoogleDriveStructureService;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.LinkParentRequest;
import com.mcschool.flashcard.students.dto.ParentInvitationResponse;
import com.mcschool.flashcard.students.dto.PilotDueCardResponse;
import com.mcschool.flashcard.students.dto.StudentListResponse;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.students.dto.TestReviewReminderResponse;
import com.mcschool.flashcard.students.dto.UpdateStudentDriveFolderRequest;
import com.mcschool.flashcard.students.dto.UpdateStudentHomeworkDriveFolderRequest;
import com.mcschool.flashcard.students.dto.UpdateStudentNameRequest;
import com.mcschool.flashcard.students.dto.UpdateStudentTranscriptDriveFolderRequest;
import com.mcschool.flashcard.users.Invitations;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import com.mcschool.flashcard.users.UserStatus;
import com.mcschool.flashcard.users.dto.ChangePasswordRequest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudentService {

    private static final SecureRandom USERNAME_RANDOM = new SecureRandom();

    private final UserRepository userRepository;
    private final CardRepository cardRepository;
    private final NotificationService notificationService;
    private final DailyReviewHistoryService historyService;
    private final PasswordEncoder passwordEncoder;
    private final GoogleDriveStructureService googleDriveStructureService;
    private final ZoneId reviewReminderZone;

    public StudentService(UserRepository userRepository, CardRepository cardRepository,
                          NotificationService notificationService,
                          DailyReviewHistoryService historyService,
                          PasswordEncoder passwordEncoder,
                          String reviewReminderZone) {
        this(userRepository, cardRepository, notificationService, historyService,
                passwordEncoder, null, reviewReminderZone);
    }

    @Autowired
    public StudentService(UserRepository userRepository, CardRepository cardRepository,
                          NotificationService notificationService,
                          DailyReviewHistoryService historyService,
                          PasswordEncoder passwordEncoder,
                          GoogleDriveStructureService googleDriveStructureService,
                          @Value("${app.notifications.review-reminders.zone}") String reviewReminderZone) {
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
        this.notificationService = notificationService;
        this.historyService = historyService;
        this.passwordEncoder = passwordEncoder;
        this.googleDriveStructureService = googleDriveStructureService;
        this.reviewReminderZone = ZoneId.of(reviewReminderZone);
    }

    @Transactional
    public StudentInvitationResponse createStudent(AuthenticatedUser teacher, CreateStudentRequest request) {
        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
        User student = userRepository.save(User.managedStudent(request.fullName().trim(), teacherEntity));
        ensureUsername(student);
        if (googleDriveStructureService != null) {
            googleDriveStructureService.provisionIndividualStudent(teacherEntity, student);
        }
        return new StudentInvitationResponse(UserResponse.from(student), null, null);
    }

    @Transactional
    public ParentInvitationResponse linkParent(AuthenticatedUser teacher, UUID studentId, LinkParentRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        String email = normalizeOptionalEmail(request.email());
        if (email == null) {
            throw new IllegalArgumentException("Parent email is required");
        }

        User parent = userRepository.findByEmail(email).orElse(null);
        String token = null;
        Instant expiresAt = null;

        if (parent == null) {
            token = Invitations.newToken();
            expiresAt = Invitations.expiry(Instant.now());
            parent = userRepository.save(User.invitedParent(request.fullName().trim(), email, token, expiresAt));
            notificationService.sendInvitation(parent, token);
        } else {
            if (parent.getRole() != Role.PARENT || parent.isArchived()) {
                throw new IllegalArgumentException("An account with this email already exists and is not a parent account");
            }
            if (parent.getStatus() == UserStatus.INVITED) {
                token = parent.getInvitationToken();
                expiresAt = parent.getInvitationExpiresAt();
            }
        }

        student.linkParent(parent);
        return new ParentInvitationResponse(UserResponse.from(parent), token, expiresAt);
    }

    @Transactional
    public List<StudentListResponse> listStudents(AuthenticatedUser teacher) {
        return userRepository.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(teacher.id(), Role.STUDENT).stream()
                .peek(this::prepareManagedStudent)
                .map(StudentListResponse::from)
                .toList();
    }

    @Transactional
    public StudentListResponse getStudent(AuthenticatedUser teacher, UUID studentId) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        prepareManagedStudent(student);
        return StudentListResponse.from(student);
    }

    @Transactional
    public StudentListResponse updateStudentName(AuthenticatedUser teacher, UUID studentId,
                                                 UpdateStudentNameRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.changeFullName(request.fullName().trim());
        return StudentListResponse.from(student);
    }

    @Transactional
    public void resetStudentPassword(AuthenticatedUser teacher, UUID studentId, ChangePasswordRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        prepareManagedStudent(student);
        student.changePasswordHash(passwordEncoder.encode(request.password()));
    }

    @Transactional
    public StudentListResponse updateGoogleDriveFolder(AuthenticatedUser teacher, UUID studentId,
                                                       UpdateStudentDriveFolderRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.changeGoogleDriveFolderUrl(request.googleDriveFolderUrl());
        return StudentListResponse.from(student);
    }

    @Transactional
    public StudentListResponse updateGoogleDriveHomeworkFolder(AuthenticatedUser teacher, UUID studentId,
                                                               UpdateStudentHomeworkDriveFolderRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.changeGoogleDriveHomeworkFolderId(request.googleDriveHomeworkFolderId());
        return StudentListResponse.from(student);
    }

    @Transactional
    public StudentListResponse updateGoogleDriveTranscriptFolder(AuthenticatedUser teacher, UUID studentId,
                                                                  UpdateStudentTranscriptDriveFolderRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        student.changeGoogleDriveTranscriptFolderId(request.googleDriveTranscriptFolderId());
        return StudentListResponse.from(student);
    }

    @Transactional
    public TestReviewReminderResponse sendTestReviewReminder(AuthenticatedUser teacher, UUID studentId) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        prepareManagedStudent(student);
        LocalDate today = reviewToday();
        long dueCount = cardRepository.countDueCards(studentId, today);
        if (dueCount > 0) {
            historyService.recordDueSnapshot(student, today, dueCount);
            notificationService.sendDailyTaskReminder(student, dueCount, 0);
            return new TestReviewReminderResponse(studentId, dueCount, true);
        }
        return new TestReviewReminderResponse(studentId, 0, false);
    }

    @Transactional
    public PilotDueCardResponse makeOneCardDueToday(AuthenticatedUser teacher, UUID studentId) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        prepareManagedStudent(student);
        Card card = cardRepository.findFirstByStudentIdAndStatusAndArchivedFalseOrderByCreatedAtAsc(
                        studentId, CardStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("No active card found for student"));
        card.markDueOn(reviewToday());
        return PilotDueCardResponse.from(cardRepository.save(card));
    }

    @Transactional
    public void deleteStudent(AuthenticatedUser teacher, UUID studentId) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        cardRepository.archiveAllByStudentId(studentId);
        student.archive();
    }

    private User requireOwnedStudent(UUID teacherId, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(u -> u.getRole() == Role.STUDENT)
                .filter(u -> !u.isArchived())
                .filter(u -> u.getTeacher() != null && u.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }

    private void prepareManagedStudent(User student) {
        if (student.getStatus() == UserStatus.INVITED) {
            student.enableManagedStudent();
        }
        ensureUsername(student);
    }

    private void ensureUsername(User student) {
        if (student.getRole() != Role.STUDENT || (student.getUsername() != null && !student.getUsername().isBlank())) {
            return;
        }
        String base = usernameBase(student.getFullName());
        for (int attempt = 0; attempt < 1000; attempt++) {
            String candidate = base + (100 + USERNAME_RANDOM.nextInt(900));
            if (!userRepository.existsByUsernameIgnoreCase(candidate)) {
                student.assignUsername(candidate);
                return;
            }
        }
        throw new IllegalStateException("Could not generate a unique student username");
    }

    private static String usernameBase(String fullName) {
        String first = fullName == null ? "student" : fullName.trim().split("\\s+")[0];
        String cleaned = first.replaceAll("[^\\p{L}\\p{N}]", "");
        if (cleaned.isBlank()) {
            cleaned = "student";
        }
        if (cleaned.length() > 40) {
            cleaned = cleaned.substring(0, 40);
        }
        return cleaned;
    }

    private LocalDate reviewToday() {
        return LocalDate.now(reviewReminderZone);
    }

    private static String normalizeOptionalEmail(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
