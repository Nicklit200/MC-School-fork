package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.monthlyplans.MonthlyPlan;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanRepository;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanTargetType;
import com.mcschool.flashcard.monthlyplans.MonthlyReadinessCalculator;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Resolves the pupil's individual month-to-skill mapping for the shared
 * school calendar. Only curriculum metadata is returned, never the private
 * lesson plan, and all scores are recalculated from the existing skill mastery.
 */
@Service
public class StudentMonthlyCurriculumService {
    public record MonthEntry(String month, List<String> skillIds, List<String> topics,
                             List<String> unmappedTopics, String source, String track,
                             String calendarStatus, MonthlyReadinessCalculator.Readiness readiness) {}
    public record YearEntry(UUID studentId, String boardId, String schoolYear, List<MonthEntry> months) {}

    private final SkillMasteryService mastery;
    private final SkillBoardService boards;
    private final MonthlyPlanRepository plans;
    private final UserRepository users;
    private final ObjectMapper mapper;

    public StudentMonthlyCurriculumService(SkillMasteryService mastery,
                                           SkillBoardService boards,
                                           MonthlyPlanRepository plans,
                                           UserRepository users,
                                           ObjectMapper mapper) {
        this.mastery = mastery;
        this.boards = boards;
        this.plans = plans;
        this.users = users;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public YearEntry year(String boardId, UUID studentId, int schoolYearStart, AuthenticatedUser caller) {
        if (schoolYearStart < 2020 || schoolYearStart > 2099)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неверный учебный год");
        // Reuse the exact ADMIN/TEACHER ownership checks already enforced for mastery.
        var values = mastery.get(boardId, studentId, caller);
        var board = boards.get(boardId).data();
        User student = users.findById(studentId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ученик не найден"));
        String year = schoolYearStart + "/" + String.format("%02d", (schoolYearStart + 1) % 100);
        if (student.getGrade() == null || student.getGrade() != board.grade() || student.getTeacher() == null)
            return new YearEntry(studentId, boardId, year, List.of());

        Set<String> validSkills = new HashSet<>();
        for (var node : board.nodes()) {
            if (!"skill".equals(node.kind()) || node.archived()) continue;
            if (node.schoolTypes() != null && !node.schoolTypes().isEmpty()
                    && !node.schoolTypes().contains(student.getSchoolType())) continue;
            validSkills.add(node.id());
        }

        List<MonthlyPlan> records = plans.findByTeacherIdAndTargetTypeAndTargetIdAndPlanMonthBetween(
                student.getTeacher().getId(), MonthlyPlanTargetType.STUDENT, studentId,
                schoolYearStart + "-09", (schoolYearStart + 1) + "-07");
        List<MonthEntry> months = new ArrayList<>();
        for (MonthlyPlan plan : records) {
            try {
                JsonNode curriculum = mapper.readTree(plan.getPlanJson()).path("curriculum");
                if (!curriculum.isObject() || !curriculum.path("skillIds").isArray()) continue;
                if (!boardId.equals(curriculum.path("boardId").asText(""))
                        || curriculum.path("grade").asInt(-1) != board.grade()
                        || !Objects.equals(student.getSchoolType(), curriculum.path("schoolType").asText(""))) continue;
                String plannedMonth = curriculum.path("month").asText("");
                if (!plannedMonth.isBlank() && !plannedMonth.equals(plan.getPlanMonth())) continue;
                String plannedYear = curriculum.path("schoolYear").asText("");
                if (!plannedYear.isBlank() && !year.equals(plannedYear)) continue;

                List<String> missing = new ArrayList<>(strings(curriculum.path("unmappedTopics")));
                List<String> skillIds = new ArrayList<>();
                for (String id : strings(curriculum.path("skillIds"))) {
                    if (validSkills.contains(id)) skillIds.add(id);
                    else missing.add("Навык больше не активен в карте: " + id);
                }
                skillIds = new ArrayList<>(new LinkedHashSet<>(skillIds));
                // Do not replace a valid calendar with an empty or obsolete plan.
                if (skillIds.isEmpty()) continue;
                var readiness = MonthlyReadinessCalculator.calculate(skillIds, missing, values.mastery());
                months.add(new MonthEntry(
                        plan.getPlanMonth(), skillIds, strings(curriculum.path("topics")),
                        missing, curriculum.path("source").asText(""),
                        curriculum.path("track").asText(""),
                        curriculum.path("calendarStatus").asText("APPROXIMATE"), readiness));
            } catch (RuntimeException ignored) {
                // A malformed historical plan must not break other months.
            }
        }
        months.sort(Comparator.comparing(MonthEntry::month));
        return new YearEntry(studentId, boardId, year, months);
    }

    private static List<String> strings(JsonNode values) {
        if (!values.isArray()) return List.of();
        List<String> result = new ArrayList<>();
        for (int i = 0; i < values.size() && i < 100; i++) {
            JsonNode value = values.get(i);
            if (value.isTextual() && !value.asText().isBlank())
                result.add(value.asText().length() > 240 ? value.asText().substring(0, 240) : value.asText());
        }
        return result;
    }
}
