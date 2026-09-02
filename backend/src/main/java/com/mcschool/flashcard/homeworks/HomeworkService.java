package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.dto.CreateHomeworkRequest;
import com.mcschool.flashcard.homeworks.dto.HomeworkResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HomeworkService {

    private final HomeworkRepository homeworkRepository;
    private final UserRepository userRepository;

    public HomeworkService(HomeworkRepository homeworkRepository,
                           UserRepository userRepository) {
        this.homeworkRepository = homeworkRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    public HomeworkResponse createHomework(AuthenticatedUser teacher, UUID studentId,
                                           CreateHomeworkRequest request) {
        User student = requireOwnedStudent(teacher.id(), studentId);
        Homework homework = homeworkRepository.save(Homework.create(student, request.startDate()));
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

    private User requireOwnedStudent(UUID teacherId, UUID studentId) {
        return userRepository.findById(studentId)
                .filter(u -> u.getRole() == Role.STUDENT)
                .filter(u -> !u.isArchived())
                .filter(u -> u.getTeacher() != null && u.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }
}
