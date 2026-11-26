package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Adds recorded lifecycle evidence only after the caller's lesson access has been checked. */
@Service
@Transactional(readOnly = true)
public class LessonExecutionSummaryService {
    private final OnlineClassRepository classes;

    public LessonExecutionSummaryService(OnlineClassRepository classes) {
        this.classes = classes;
    }

    public List<GroupLessonResponse> enrichCurrent(UUID teacherId, List<GroupLessonResponse> lessons) {
        Map<String, Execution> executions = forTeacher(teacherId,
                lessons.stream().map(GroupLessonResponse::eventId).toList());
        return lessons.stream().map(lesson -> {
            Execution execution = executions.getOrDefault(lesson.eventId(), Execution.UNKNOWN);
            // Rebinding the schedule does not rewrite a retired room's audience.
            if (!Objects.equals(execution.studentId(), lesson.studentId())
                    || !Objects.equals(execution.groupId(), lesson.groupId())) execution = Execution.UNKNOWN;
            return lesson.withExecution(execution.status(), execution.start(), execution.end());
        }).toList();
    }

    /** Rows must come from the authorized student-history service, never from client-supplied IDs. */
    public List<StudentLessonHistoryItem> enrichHistory(UUID studentId, List<StudentLessonHistoryItem> lessons) {
        Map<UUID, List<String>> eventIdsByTeacher = new LinkedHashMap<>();
        for (StudentLessonHistoryItem lesson : lessons) {
            eventIdsByTeacher.computeIfAbsent(lesson.sourceTeacherId(), ignored -> new ArrayList<>())
                    .add(lesson.eventId());
        }
        Map<UUID, Map<String, Execution>> byTeacher = new LinkedHashMap<>();
        eventIdsByTeacher.forEach((teacherId, eventIds) -> byTeacher.put(teacherId, forTeacher(teacherId, eventIds)));
        return lessons.stream().map(lesson -> {
            Execution execution = byTeacher.get(lesson.sourceTeacherId())
                    .getOrDefault(lesson.eventId(), Execution.UNKNOWN);
            // Calendar synchronization can preserve the pupil's historical roster
            // while rebinding the event to someone else. Never attach that newer
            // individual room's lifecycle to this pupil, or a teacher-only rehearsal.
            if (execution.studentId() != null ? !execution.studentId().equals(studentId)
                    : execution.groupId() == null) execution = Execution.UNKNOWN;
            return lesson.withExecution(execution.status(), execution.start(), execution.end());
        }).toList();
    }

    private Map<String, Execution> forTeacher(UUID teacherId, List<String> eventIds) {
        if (eventIds.isEmpty()) return Map.of();
        Map<String, Execution> executions = new LinkedHashMap<>();
        // A rescheduled or rebound occurrence can have retired rooms. The newest
        // materialization wins, regardless of its scheduled start or terminal state.
        for (var room : classes.findAllByTeacherIdAndEventIdInOrderByCreatedAtDescIdDesc(
                teacherId, eventIds.stream().distinct().toList())) {
            executions.putIfAbsent(room.getEventId(), new Execution(
                    room.getStatus(), room.getActualStartAt(), room.getActualEndAt(),
                    room.getStudent() == null ? null : room.getStudent().getId(),
                    room.getGroup() == null ? null : room.getGroup().getId()));
        }
        return executions;
    }

    private record Execution(OnlineClassStatus status, Instant start, Instant end, UUID studentId, UUID groupId) {
        private static final Execution UNKNOWN = new Execution(null, null, null, null, null);
    }
}
