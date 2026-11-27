package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Resolves the effective roster for one lesson occurrence.
 *
 * The occurrence snapshot is authoritative whenever it exists, including an
 * intentionally empty snapshot. Permanent group membership is only a legacy
 * fallback for lessons that have no occurrence-level roster yet.
 */
@Service
public class WorkbookLessonRosterService {
    public record Student(UUID id, String name) {}
    public record Roster(List<Student> students, String source, boolean needsTeacherReview) {
        public Roster {
            students = List.copyOf(students);
        }
    }

    private final LessonParticipantsService lessonParticipants;
    private final McpHomeworkSeriesService homeworkSeries;

    public WorkbookLessonRosterService(LessonParticipantsService lessonParticipants,
                                       McpHomeworkSeriesService homeworkSeries) {
        this.lessonParticipants = lessonParticipants;
        this.homeworkSeries = homeworkSeries;
    }

    public Roster resolve(AuthenticatedUser teacher, GroupLessonResponse lesson) {
        if (teacher == null || lesson == null || lesson.eventId() == null || lesson.eventId().isBlank())
            throw new IllegalArgumentException("An authenticated teacher and exact lesson are required");

        if (lessonParticipants.hasLesson(teacher.id(), lesson.eventId())) {
            List<Student> students = lessonParticipants.list(teacher, lesson.eventId()).stream()
                    .map(participant -> new Student(participant.studentId(), participant.studentName()))
                    .toList();
            return new Roster(students, "LESSON_OCCURRENCE", false);
        }

        if (lesson.studentId() != null) {
            return new Roster(List.of(new Student(lesson.studentId(),
                    lesson.studentName() == null ? "Student" : lesson.studentName())),
                    "SINGLE_STUDENT_BINDING", false);
        }

        if (lesson.groupId() == null)
            return new Roster(List.of(), "TRIAL_NO_REGISTERED_STUDENTS", false);

        Map<String, Object> response = homeworkSeries.findTargets(teacher, "");
        Object rawTargets = response.get("targets");
        Map<UUID, Student> members = new LinkedHashMap<>();
        if (rawTargets instanceof List<?> targets) {
            for (Object rawTarget : targets) {
                if (!(rawTarget instanceof Map<?, ?> target)
                        || !"group".equalsIgnoreCase(String.valueOf(target.get("type")))
                        || !lesson.groupId().toString().equals(String.valueOf(target.get("id"))))
                    continue;
                Object rawStudents = target.get("students");
                if (rawStudents instanceof List<?> students) {
                    for (Object rawStudent : students) {
                        if (!(rawStudent instanceof Map<?, ?> student) || student.get("id") == null) continue;
                        try {
                            UUID id = UUID.fromString(String.valueOf(student.get("id")));
                            String name = student.get("name") == null ? "Student" : String.valueOf(student.get("name"));
                            members.putIfAbsent(id, new Student(id, name));
                        } catch (IllegalArgumentException ignored) {
                            // Ignore malformed legacy target rows; never invent a student identity.
                        }
                    }
                }
                break;
            }
        }
        return new Roster(new ArrayList<>(members.values()),
                "PERMANENT_GROUP_MEMBERSHIP_FALLBACK", true);
    }
}
