package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.dto.CreateHomeworkRequest;
import com.mcschool.flashcard.homeworks.dto.HomeworkResponse;
import com.mcschool.flashcard.notifications.PushSubscription;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HomeworkService {

    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");

    private final HomeworkRepository homeworkRepository;
    private final UserRepository userRepository;
    private final PushSubscriptionRepository pushSubscriptionRepository;
    private final WebPushService webPushService;

    public HomeworkService(HomeworkRepository homeworkRepository,
                           UserRepository userRepository,
                           PushSubscriptionRepository pushSubscriptionRepository,
                           WebPushService webPushService) {
        this.homeworkRepository = homeworkRepository;
        this.userRepository = userRepository;
        this.pushSubscriptionRepository = pushSubscriptionRepository;
        this.webPushService = webPushService;
    }

    @Transactional
    public HomeworkResponse createHomework(AuthenticatedUser teacher, UUID studentId,
                                           CreateHomeworkRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        Homework homework = homeworkRepository.save(Homework.create(student, request.startDate()));

        if (request.startDate().equals(LocalDate.now(SCHOOL_ZONE))) {
            notifyTodayAssignment(student, homework.getId());
        }

        return HomeworkResponse.from(homework, Map.of());
    }

    @Transactional(readOnly = true)
    public List<HomeworkResponse> listForTeacher(AuthenticatedUser teacher, UUID studentId) {
        requireOwnedStudent(teacher.id(), studentId);
        return listForStudent(studentId);
    }

    @Transactional(readOnly = true)
    public List<HomeworkResponse> listForStudent(AuthenticatedUser student) {
        return listForStudent(student.id());
    }

    private List<HomeworkResponse> listForStudent(UUID studentId) {
        List<Homework> homeworks = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(studentId);
        Map<UUID, HomeworkStats> stats = homeworkRepository.statsByStudentId(studentId).stream()
                .collect(Collectors.toMap(HomeworkStats::homeworkId, Function.identity()));
        return homeworks.stream()
                .map(homework -> HomeworkResponse.from(homework, stats))
                .toList();
    }

    private void notifyTodayAssignment(User student, UUID homeworkId) {
        if (!webPushService.isConfigured()) return;
        String url = "/student/homeworks/" + homeworkId;
        for (PushSubscription subscription : pushSubscriptionRepository.findAllByUserId(student.getId())) {
            try {
                webPushService.send(
                        subscription,
                        "Mindcrafti School",
                        "Тебе задана новая домашняя работа на сегодня 📝",
                        url);
            } catch (RuntimeException ignored) {
                // Homework creation must still succeed even if a device subscription is broken.
            }
        }
    }

    private User requireOwnedStudent(UUID teacherId, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(u -> u.getRole() == Role.STUDENT)
                .filter(u -> !u.isArchived())
                .filter(u -> u.getTeacher() != null && u.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }
}
