package com.mcschool.flashcard.monthlyplans;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.monthlyplans.dto.MonthlyPlanResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class MonthlyPlanService {
    private static final Pattern MONTH_PATTERN = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");

    private final MonthlyPlanRepository repository;
    private final UserRepository userRepository;
    private final StudentGroupRepository groupRepository;
    private final ObjectMapper objectMapper;

    public MonthlyPlanService(
            MonthlyPlanRepository repository,
            UserRepository userRepository,
            StudentGroupRepository groupRepository,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.groupRepository = groupRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public MonthlyPlanResponse get(AuthenticatedUser teacher, String targetType, UUID targetId, String month) {
        MonthlyPlanTargetType type = parseTargetType(targetType);
        validateMonth(month);
        requireOwnedTarget(teacher.id(), type, targetId);
        return repository.findByTeacherIdAndTargetTypeAndTargetIdAndPlanMonth(teacher.id(), type, targetId, month)
                .map(MonthlyPlanResponse::from)
                .orElseGet(() -> MonthlyPlanResponse.empty(type, targetId, month));
    }

    @Transactional
    public MonthlyPlanResponse save(
            AuthenticatedUser teacher,
            String targetType,
            UUID targetId,
            String month,
            String planJson) {
        MonthlyPlanTargetType type = parseTargetType(targetType);
        validateMonth(month);
        validatePlanJson(planJson);
        requireOwnedTarget(teacher.id(), type, targetId);

        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));

        MonthlyPlan plan = repository.findByTeacherIdAndTargetTypeAndTargetIdAndPlanMonth(
                        teacher.id(), type, targetId, month)
                .orElseGet(() -> MonthlyPlan.create(teacherEntity, type, targetId, month, planJson));
        plan.updatePlanJson(planJson);
        return MonthlyPlanResponse.from(repository.save(plan));
    }

    private MonthlyPlanTargetType parseTargetType(String value) {
        try {
            return MonthlyPlanTargetType.valueOf(value == null ? "" : value.trim().toUpperCase(Locale.ROOT));
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("targetType must be STUDENT or GROUP");
        }
    }

    private void validateMonth(String month) {
        if (month == null || !MONTH_PATTERN.matcher(month).matches()) {
            throw new IllegalArgumentException("month must use YYYY-MM format");
        }
    }

    private void validatePlanJson(String planJson) {
        if (planJson == null || planJson.isBlank()) throw new IllegalArgumentException("planJson is required");
        if (planJson.length() > 100000) throw new IllegalArgumentException("planJson is too large");
        try {
            if (!objectMapper.readTree(planJson).isObject()) {
                throw new IllegalArgumentException("planJson must be a JSON object");
            }
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalArgumentException("planJson must contain valid JSON");
        }
    }

    private void requireOwnedTarget(UUID teacherId, MonthlyPlanTargetType type, UUID targetId) {
        if (type == MonthlyPlanTargetType.GROUP) {
            groupRepository.findByIdAndTeacherId(targetId, teacherId)
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
            return;
        }

        userRepository.findById(targetId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && teacherId.equals(user.getTeacher().getId()))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }
}
