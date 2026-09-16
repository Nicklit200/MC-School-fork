package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.dto.CreateHomeworkRequest;
import com.mcschool.flashcard.homeworks.dto.HomeworkResponse;
import com.mcschool.flashcard.homeworks.dto.SaveHomeworkFinalAnswersRequest;
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

    @Transactional
    public void saveFinalAnswers(AuthenticatedUser student, UUID homeworkId,
                                 SaveHomeworkFinalAnswersRequest request) {
        Homework homework = requireStudentHomework(student, homeworkId);
        if (homework.isSubmitted()) throw new ConflictException("Homework is already submitted");
        homework.changeFinalAnswersJson(toJson(request.answers()));
    }

    @Transactional(readOnly = true)
    public void requireFinalAnswers(AuthenticatedUser student, UUID homeworkId) {
        Homework homework = requireStudentHomework(student, homeworkId);
        if (homework.getFinalAnswersJson() == null || homework.getFinalAnswersJson().isBlank()) {
            throw new ConflictException("Enter and save final answers before submitting homework");
        }
    }

    @Transactional
    public void deleteHomework(AuthenticatedUser teacher, UUID homeworkId) {
        Homework homework = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new ResourceNotFoundException("Homework not found"));
        User student = homework.getStudent();
        requireOwnedStudent(teacher.id(), student.getId());

        HomeworkStats stats = homeworkRepository.statsByStudentId(student.getId()).stream()
                .filter(item -> item.homeworkId().equals(homeworkId))
                .findFirst()
                .orElse(null);
        if (stats != null && stats.totalCards() > 0) {
            throw new ConflictException("Homework with cards cannot be deleted from the PDF overview");
        }
        homeworkRepository.delete(homework);
    }

    private Homework requireStudentHomework(AuthenticatedUser student, UUID homeworkId) {
        if (student.role() != Role.STUDENT) throw new IllegalStateException("Student role required");
        return homeworkRepository.findByIdAndStudentId(homeworkId, student.id())
                .orElseThrow(() -> new ResourceNotFoundException("Homework not found"));
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

    private String toJson(List<SaveHomeworkFinalAnswersRequest.FinalAnswer> answers) {
        return answers.stream()
                .map(answer -> "{\"label\":\"" + jsonEscape(answer.label().trim())
                        + "\",\"answer\":\"" + jsonEscape(answer.answer().trim()) + "\"}")
                .collect(Collectors.joining(",", "[", "]"));
    }

    private String jsonEscape(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\t", "\\t");
    }
}
