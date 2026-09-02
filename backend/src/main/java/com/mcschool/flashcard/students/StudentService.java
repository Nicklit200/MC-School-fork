package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.CardStatus;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.PilotDueCardResponse;
import com.mcschool.flashcard.students.dto.StudentListResponse;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.students.dto.TestReviewReminderResponse;
import com.mcschool.flashcard.students.dto.UpdateStudentDriveFolderRequest;
import com.mcschool.flashcard.users.Invitations;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudentService {

    private static final Logger log = LoggerFactory.getLogger(StudentService.class);

    private final UserRepository userRepository;
    private final CardRepository cardRepository;
    private final NotificationService notificationService;
    private final DailyReviewHistoryService historyService;
    private final ZoneId reviewReminderZone;

    public StudentService(UserRepository userRepository, CardRepository cardRepository,
                          NotificationService notificationService,
                          DailyReviewHistoryService historyService,
                          @Value("${app.notifications.review-reminders.zone}") String reviewReminderZone) {
        this.userRepository = userRepository;
        this.cardRepository = cardRepository;
        this.notificationService = notificationService;
        this.historyService = historyService;
        this.reviewReminderZone = ZoneId.of(reviewReminderZone);
    }

    @Transactional
    public StudentInvitationResponse createStudent(AuthenticatedUser teacher, CreateStudentRequest request) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsByEmail(email)) {
            throw new ConflictException("An account with this email already exists");
        }
        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
        String token = Invitations.newToken();
        Instant expiresAt = Invitations.expiry(Instant.now());
        User student = userRepository.save(
                User.invitedStudent(request.fullName().trim(), email, teacherEntity, token, expiresAt));
        log.info("Sending student invitation email for studentId={} email={}", student.getId(), student.getEmail());
        notificationService.sendInvitation(student, token);
        log.info("Finished student invitation email attempt for studentId={} email={}",
                student.getId(), student.getEmail());
        return new StudentInvitationResponse(UserResponse.from(student), token, expiresAt);
    }

    @Transactional(readOnly = true)
    public List<StudentListResponse> listStudents(AuthenticatedUser teacher) {
        return userRepository.findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacher.id()).stream()
                .map(StudentListResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public StudentListResponse getStudent(AuthenticatedUser teacher, UUID studentId) {
        return StudentListResponse.from(requireOwnedStudent(teacher.id(), studentId));
    }

    @Transactional
    public StudentListResponse updateGoogleDriveFolder(AuthenticatedUser teacher, UUID studentId,
                                                       UpdateStudentDriveFolderRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        String folderId = request.googleDriveFolderUrl();
        student.changeGoogleDriveFolderUrl(folderId);
        return StudentListResponse.from(student);
    }

    @Transactional
    public TestReviewReminderResponse sendTestReviewReminder(AuthenticatedUser teacher, UUID studentId) {
        User student = requireOwnedActiveStudent(teacher.id(), studentId);
        LocalDate today = reviewToday();
        long dueCount = cardRepository.countDueCards(studentId, today);
        if (dueCount > 0) {
            historyService.recordDueSnapshot(student, today, dueCount);
            notificationService.sendReviewReminder(student, dueCount);
            return new TestReviewReminderResponse(studentId, dueCount, true);
        }
        return new TestReviewReminderResponse(studentId, 0, false);
    }

    @Transactional
    public PilotDueCardResponse makeOneCardDueToday(AuthenticatedUser teacher, UUID studentId) {
        requireOwnedActiveStudent(teacher.id(), studentId);
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

    private User requireOwnedActiveStudent(UUID teacherId, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(u -> u.getRole() == Role.STUDENT)
                .filter(u -> u.getStatus() == UserStatus.ACTIVE)
                .filter(u -> !u.isArchived())
                .filter(u -> u.getTeacher() != null && u.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Active student not found"));
    }

    private LocalDate reviewToday() {
        return LocalDate.now(reviewReminderZone);
    }
}
