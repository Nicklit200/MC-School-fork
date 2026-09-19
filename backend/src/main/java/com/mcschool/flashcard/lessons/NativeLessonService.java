package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.CreateNativeLessonRequest;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NativeLessonService {

    private static final String EVENT_PREFIX = "native:";

    private final NativeLessonRepository repository;
    private final UserRepository userRepository;
    private final StudentGroupRepository groupRepository;

    public NativeLessonService(NativeLessonRepository repository,
                               UserRepository userRepository,
                               StudentGroupRepository groupRepository) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.groupRepository = groupRepository;
    }

    @Transactional(readOnly = true)
    public List<GroupLessonResponse> listLessons(AuthenticatedUser teacher) {
        Instant now = Instant.now();
        return repository
                .findAllByTeacherIdAndStartsAtBetweenOrderByStartsAtAsc(
                        teacher.id(),
                        now.minus(90, ChronoUnit.DAYS),
                        now.plus(365, ChronoUnit.DAYS))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public List<GroupLessonResponse> create(AuthenticatedUser caller, CreateNativeLessonRequest request) {
        if (request == null || request.startsAt() == null || request.endsAt() == null) {
            throw new IllegalArgumentException("Lesson start and end are required");
        }
        if (!request.endsAt().isAfter(request.startsAt())) {
            throw new IllegalArgumentException("Lesson end must be after start");
        }
        if ((request.studentId() == null) == (request.groupId() == null)) {
            throw new IllegalArgumentException("Choose exactly one student or group");
        }

        int repeatWeeks = request.repeatWeeks() == null ? 1 : request.repeatWeeks();
        if (repeatWeeks < 1 || repeatWeeks > 52) {
            throw new IllegalArgumentException("repeatWeeks must be between 1 and 52");
        }

        User teacher = userRepository.findById(caller.id())
                .filter(user -> !user.isArchived() && user.getRole() == Role.TEACHER)
                .orElseThrow(() -> new ResourceNotFoundException("Teacher not found"));

        User student = null;
        StudentGroup group = null;
        if (request.studentId() != null) {
            student = userRepository.findById(request.studentId())
                    .filter(user -> !user.isArchived())
                    .filter(user -> user.getRole() == Role.STUDENT)
                    .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(caller.id()))
                    .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        } else {
            group = groupRepository.findByIdAndTeacherId(request.groupId(), caller.id())
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
        }

        String title = request.title() == null || request.title().isBlank()
                ? (group != null ? group.getName() : student.getFullName())
                : request.title().strip();

        UUID seriesId = UUID.randomUUID();
        List<NativeLesson> created = new ArrayList<>();
        for (int week = 0; week < repeatWeeks; week += 1) {
            Instant start = request.startsAt().plus(week * 7L, ChronoUnit.DAYS);
            Instant end = request.endsAt().plus(week * 7L, ChronoUnit.DAYS);
            created.add(group != null
                    ? NativeLesson.forGroup(teacher, group, title, start, end, seriesId)
                    : NativeLesson.forStudent(teacher, student, title, start, end, seriesId));
        }

        return repository.saveAll(created).stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public GroupLessonResponse requireLesson(AuthenticatedUser teacher, String eventId) {
        UUID id = parseEventId(eventId);
        NativeLesson lesson = repository.findByIdAndTeacherId(id, teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        return toResponse(lesson);
    }

    public boolean isNativeEventId(String eventId) {
        return eventId != null && eventId.startsWith(EVENT_PREFIX);
    }

    private UUID parseEventId(String eventId) {
        if (!isNativeEventId(eventId)) {
            throw new ResourceNotFoundException("Lesson not found");
        }
        try {
            return UUID.fromString(eventId.substring(EVENT_PREFIX.length()));
        } catch (IllegalArgumentException ex) {
            throw new ResourceNotFoundException("Lesson not found");
        }
    }

    private GroupLessonResponse toResponse(NativeLesson lesson) {
        return new GroupLessonResponse(
                lesson.eventId(),
                lesson.bindingKey(),
                lesson.getGroup() == null ? null : lesson.getGroup().getId(),
                lesson.getGroup() == null ? null : lesson.getGroup().getName(),
                lesson.getStudent() == null ? null : lesson.getStudent().getId(),
                lesson.getStudent() == null ? null : lesson.getStudent().getFullName(),
                lesson.getTitle(),
                lesson.getStartsAt(),
                lesson.getEndsAt(),
                null,
                null
        );
    }
}
