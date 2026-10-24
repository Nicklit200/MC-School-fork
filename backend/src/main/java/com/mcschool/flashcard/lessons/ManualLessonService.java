package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.CreateLessonRequest;
import com.mcschool.flashcard.lessons.dto.CreateLessonSeriesRequest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Native lessons share the durable schedule and preparation records with imported lessons. */
@Service
public class ManualLessonService {
    public static final String EVENT_PREFIX = "local-";
    private final UserRepository users;
    private final StudentGroupRepository groups;
    private final StudentGroupMemberRepository members;
    private final LessonHistoryRepository history;

    public ManualLessonService(UserRepository users, StudentGroupRepository groups,
                               StudentGroupMemberRepository members, LessonHistoryRepository history) {
        this.users = users;
        this.groups = groups;
        this.members = members;
        this.history = history;
    }

    @Transactional
    public GroupLessonResponse create(AuthenticatedUser caller, CreateLessonRequest request) {
        User teacher = requireTeacher(caller);
        if (request.title() == null || request.title().isBlank() || request.title().length() > 500
                || request.startsAt() == null || request.endsAt() == null
                || !request.endsAt().isAfter(request.startsAt()) || !request.isTargetValid()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid lesson details");
        }
        String eventId = EVENT_PREFIX + UUID.randomUUID();
        GroupLessonResponse lesson = new GroupLessonResponse(eventId, eventId, null, null, null, null,
                List.of(), request.title().strip(), request.startsAt(), request.endsAt(), null, null);
        lesson = withTarget(caller, lesson, request.groupId(), request.studentId());
        history.save(LessonHistoryEntry.create(teacher, lesson));
        return lesson;
    }

    /** Saves the complete finite series in one transaction; never a partially created schedule. */
    @Transactional
    public List<GroupLessonResponse> createSeries(AuthenticatedUser caller, CreateLessonSeriesRequest request) {
        requireTeacher(caller);
        if (request.title() == null || request.title().isBlank() || request.title().length() > 500
                || request.startDate() == null || request.period() == null
                || request.durationMinutes() == null || request.durationMinutes() < 1 || request.durationMinutes() > 1440
                || request.weekdays() == null || request.weekdays().isEmpty()
                || request.weekdays().stream().anyMatch(day -> day == null || day < 1 || day > 7)
                || !request.isTargetValid()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid lesson series");
        }
        LocalDate endExclusive = switch (request.period()) {
            case TWO_WEEKS -> request.startDate().plusWeeks(2);
            case THREE_WEEKS -> request.startDate().plusWeeks(3);
            case MONTH -> request.startDate().plusMonths(1);
        };
        List<GroupLessonResponse> created = new ArrayList<>();
        for (LocalDate date = request.startDate(); date.isBefore(endExclusive); date = date.plusDays(1)) {
            if (!request.weekdays().contains(date.getDayOfWeek().getValue())) continue;
            var startsAt = date.atStartOfDay(ZoneId.of("Europe/Berlin")).toInstant();
            created.add(create(caller, new CreateLessonRequest(request.title(), startsAt,
                    startsAt.plusSeconds(request.durationMinutes() * 60L), request.groupId(), request.studentId())));
        }
        if (created.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No lesson dates selected");
        return List.copyOf(created);
    }

    @Transactional
    public void bindStudent(AuthenticatedUser caller, String eventId, UUID studentId) {
        rebind(caller, eventId, null, studentId);
    }

    @Transactional
    public void bindGroup(AuthenticatedUser caller, String eventId, UUID groupId) {
        rebind(caller, eventId, groupId, null);
    }

    private void rebind(AuthenticatedUser caller, String eventId, UUID groupId, UUID studentId) {
        requireTeacher(caller);
        if (!eventId.startsWith(EVENT_PREFIX) || (groupId == null && studentId == null)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Lesson target is required");
        }
        LessonHistoryEntry entry = history.findByTeacherIdAndEventId(caller.id(), eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        entry.reassign(withTarget(caller, entry.toResponse(), groupId, studentId));
        history.save(entry);
    }

    private User requireTeacher(AuthenticatedUser caller) {
        if (caller.role() != Role.TEACHER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Teacher account is required");
        }
        return users.findById(caller.id())
                .filter(user -> user.getRole() == Role.TEACHER && !user.isArchived()
                        && user.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account not found"));
    }

    private GroupLessonResponse withTarget(AuthenticatedUser caller, GroupLessonResponse lesson,
                                          UUID groupId, UUID studentId) {
        String groupName = null;
        String studentName = null;
        List<UUID> participants = List.of();
        if (groupId != null) {
            var group = groups.findByIdAndTeacherId(groupId, caller.id())
                    .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
            groupName = group.getName();
            participants = members.findAllByGroupIdOrderByCreatedAtAsc(groupId).stream()
                    .map(member -> member.getStudent())
                    .filter(student -> student.getRole() == Role.STUDENT && !student.isArchived()
                            && student.getTeacher() != null && student.getTeacher().getId().equals(caller.id()))
                    .map(User::getId).distinct().toList();
        } else if (studentId != null) {
            User student = users.findById(studentId)
                    .filter(user -> user.getRole() == Role.STUDENT && !user.isArchived()
                            && user.getTeacher() != null && user.getTeacher().getId().equals(caller.id()))
                    .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
            studentName = student.getFullName();
            participants = List.of(student.getId());
        }
        return new GroupLessonResponse(lesson.eventId(), lesson.bindingKey(), groupId, groupName,
                studentId, studentName, participants, lesson.title(), lesson.startsAt(), lesson.endsAt(),
                lesson.meetUrl(), lesson.calendarUrl());
    }
}
