package com.mcschool.flashcard.homeworks;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.dto.CreateHomeworkRequest;
import com.mcschool.flashcard.homeworks.dto.HomeworkFinalAnswersResult;
import com.mcschool.flashcard.homeworks.dto.HomeworkResponse;
import com.mcschool.flashcard.homeworks.dto.SaveHomeworkFinalAnswersRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HomeworkService {

    private static final ObjectMapper JSON = new ObjectMapper();

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

    /**
     * Grades the compact final-answer form that appears after the PDF itself has been submitted.
     * The answer key remains server-side; the response only tells the student which rows matched.
     */
    @Transactional
    public HomeworkFinalAnswersResult saveFinalAnswers(AuthenticatedUser student, UUID homeworkId,
                                                        SaveHomeworkFinalAnswersRequest request) {
        Homework homework = requireStudentHomework(student, homeworkId);
        if (!homework.isSubmitted()) {
            throw new ConflictException("Submit the PDF homework before entering final answers");
        }
        if (!homework.hasFinalAnswerPrompt()) {
            throw new ConflictException("This homework does not require final answers");
        }

        int expectedCount = homework.getFinalAnswerCount();
        if (request.answers().size() != expectedCount) {
            throw new ConflictException("Exactly " + expectedCount + " final answers are required");
        }

        List<AnswerKeyItem> answerKey = readAnswerKey(homework.getAnswerKeyJson());
        if (answerKey.size() != expectedCount) {
            throw new IllegalStateException("Homework answer key does not match the configured answer count");
        }

        int correctCount = 0;
        List<HomeworkFinalAnswersResult.Item> items = new ArrayList<>();
        for (int index = 0; index < expectedCount; index++) {
            SaveHomeworkFinalAnswersRequest.FinalAnswer submitted = request.answers().get(index);
            AnswerKeyItem correct = answerKey.get(index);
            boolean matches = answersEquivalent(submitted.answer(), correct.answer());
            if (matches) correctCount += 1;
            String label = submitted.label().isBlank() ? correct.label() : submitted.label().trim();
            items.add(new HomeworkFinalAnswersResult.Item(label, matches));
        }

        boolean allCorrect = correctCount == expectedCount;
        homework.changeFinalAnswersJson(toJson(request.answers()), allCorrect);
        return new HomeworkFinalAnswersResult(correctCount, expectedCount, allCorrect, items);
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

    private List<AnswerKeyItem> readAnswerKey(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Homework answer key is missing");
        }
        try {
            return JSON.readValue(value, new TypeReference<List<AnswerKeyItem>>() {});
        } catch (Exception exception) {
            throw new IllegalStateException("Homework answer key is invalid", exception);
        }
    }

    private boolean answersEquivalent(String submitted, String correct) {
        String left = normalizeText(submitted);
        String right = normalizeText(correct);
        if (left.equals(right)) return true;

        NumericValue leftNumeric = parseNumeric(left);
        NumericValue rightNumeric = parseNumeric(right);
        return leftNumeric != null
                && rightNumeric != null
                && leftNumeric.unit().equals(rightNumeric.unit())
                && leftNumeric.value().compareTo(rightNumeric.value()) == 0;
    }

    private String normalizeText(String value) {
        return value.trim()
                .toLowerCase(Locale.ROOT)
                .replace('−', '-')
                .replace(',', '.')
                .replaceAll("\\s+", "")
                .replace("eur", "€");
    }

    private NumericValue parseNumeric(String normalized) {
        try {
            String unit = "";
            String number = normalized;
            if (number.endsWith("%")) {
                unit = "%";
                number = number.substring(0, number.length() - 1);
            } else if (number.endsWith("€")) {
                unit = "€";
                number = number.substring(0, number.length() - 1);
            }
            if (number.isBlank()) return null;

            BigDecimal value;
            int slash = number.indexOf('/');
            if (slash >= 0) {
                if (slash == 0 || slash == number.length() - 1 || number.indexOf('/', slash + 1) >= 0) return null;
                BigDecimal numerator = new BigDecimal(number.substring(0, slash));
                BigDecimal denominator = new BigDecimal(number.substring(slash + 1));
                if (denominator.compareTo(BigDecimal.ZERO) == 0) return null;
                value = numerator.divide(denominator, MathContext.DECIMAL128);
            } else {
                value = new BigDecimal(number);
            }
            return new NumericValue(value, unit);
        } catch (NumberFormatException exception) {
            return null;
        }
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

    private record AnswerKeyItem(String label, String answer) {}
    private record NumericValue(BigDecimal value, String unit) {}
}
