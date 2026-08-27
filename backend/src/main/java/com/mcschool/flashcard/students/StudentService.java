package com.mcschool.flashcard.students;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.study.SessionStatus;
import com.mcschool.flashcard.study.SessionType;
import com.mcschool.flashcard.study.StudySessionItem;
import com.mcschool.flashcard.study.StudySessionItemRepository;
import com.mcschool.flashcard.study.StudySessionRepository;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.students.dto.StudentReviewAnswerResponse;
import com.mcschool.flashcard.students.dto.StudentReviewSessionResponse;
import com.mcschool.flashcard.users.Invitations;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Student accounts are always owned by the teacher who created them. */
@Service
public class StudentService {

    private final UserRepository userRepository;
    private final NotificationService notificationService;
    private final StudySessionRepository studySessionRepository;
    private final StudySessionItemRepository studySessionItemRepository;

    public StudentService(UserRepository userRepository,
                          NotificationService notificationService,
                          StudySessionRepository studySessionRepository,
                          StudySessionItemRepository studySessionItemRepository) {
        this.userRepository = userRepository;
        this.notificationService = notificationService;
        this.studySessionRepository = studySessionRepository;
        this.studySessionItemRepository = studySessionItemRepository;
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
        notificationService.sendInvitation(student, token);
        return new StudentInvitationResponse(UserResponse.from(student), token, expiresAt);
    }

    @Transactional(readOnly = true)
    public List<UserResponse> listStudents(AuthenticatedUser teacher) {
        return userRepository.findAllByTeacherIdOrderByFullNameAsc(teacher.id()).stream()
                .map(UserResponse::from)
                .toList();
    }

    /** Completed scheduled repetitions, including the student's first answer on every card. */
    @Transactional(readOnly = true)
    public List<StudentReviewSessionResponse> reviewHistory(AuthenticatedUser teacher, UUID studentId) {
        User student = requireOwnedStudent(teacher, studentId);
        return studySessionRepository
                .findAllByStudentIdAndStatusAndSessionTypeOrderByCompletedAtDesc(
                        student.getId(), SessionStatus.COMPLETED, SessionType.SCHEDULED)
                .stream()
                .map(session -> {
                    List<StudentReviewAnswerResponse> answers = studySessionItemRepository
                            .findAllBySessionId(session.getId())
                            .stream()
                            .sorted(Comparator.comparing(item -> questionOf(item).toLowerCase(Locale.ROOT)))
                            .map(item -> new StudentReviewAnswerResponse(
                                    item.getCard().getId(),
                                    questionOf(item),
                                    item.getFirstSelectedAnswer(),
                                    correctAnswerOf(item),
                                    item.getFirstAnswerCorrect() != null
                                            ? item.getFirstAnswerCorrect()
                                            : item.isFirstTryClean()))
                            .toList();
                    int correct = (int) answers.stream().filter(StudentReviewAnswerResponse::correct).count();
                    return new StudentReviewSessionResponse(
                            session.getId(),
                            session.getCompletedAt(),
                            session.getTotalCards(),
                            correct,
                            session.getTotalCards() - correct,
                            answers);
                })
                .toList();
    }

    private String questionOf(StudySessionItem item) {
        return item.getQuestionSnapshot() != null ? item.getQuestionSnapshot() : item.getCard().getQuestion();
    }

    private String correctAnswerOf(StudySessionItem item) {
        return item.getCorrectAnswerSnapshot() != null
                ? item.getCorrectAnswerSnapshot()
                : item.getCard().getCorrectAnswer();
    }

    private User requireOwnedStudent(AuthenticatedUser teacher, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(teacher.id()))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }
}
