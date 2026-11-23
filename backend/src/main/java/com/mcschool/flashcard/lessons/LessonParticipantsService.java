package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The effective student roster is a snapshot of ONE lesson occurrence, not a
 * change to the student's permanent group or a recurring calendar binding.
 * Room authorization, personal workbooks and homework recipients share it.
 */
@Service
public class LessonParticipantsService {
    private static final Logger log = LoggerFactory.getLogger(LessonParticipantsService.class);
    private final LessonHistoryRepository history;
    private final UserRepository users;
    private final OnlineClassRepository rooms;

    public LessonParticipantsService(LessonHistoryRepository history, UserRepository users,
                                     OnlineClassRepository rooms) {
        this.history = history;
        this.users = users;
        this.rooms = rooms;
    }

    public record Participant(UUID studentId, String studentName) {}

    @Transactional(readOnly = true)
    public boolean hasLesson(UUID teacherId, String eventId) {
        return history.findByTeacherIdAndEventId(teacherId, eventId).isPresent();
    }

    @Transactional(readOnly = true)
    public boolean includes(UUID teacherId, String eventId, UUID studentId) {
        return history.findByTeacherIdAndEventId(teacherId, eventId)
                .filter(lesson -> lesson.getDeletedAt() == null)
                .filter(lesson -> lesson.toResponse().participantStudentIds().contains(studentId))
                .isPresent() && activeStudent(teacherId, studentId);
    }

    @Transactional(readOnly = true)
    public List<User> students(UUID teacherId, String eventId) {
        LessonHistoryEntry lesson = requireLesson(teacherId, eventId);
        return lesson.toResponse().participantStudentIds().stream().distinct()
                .map(users::findById)
                .flatMap(java.util.Optional::stream)
                .filter(user -> activeStudent(teacherId, user.getId()))
                .sorted(Comparator.comparing(User::getFullName))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<Participant> list(AuthenticatedUser teacher, String eventId) {
        requireTeacher(teacher);
        return students(teacher.id(), eventId).stream()
                .map(user -> new Participant(user.getId(), user.getFullName())).toList();
    }

    @Transactional
    public List<Participant> add(AuthenticatedUser teacher, String eventId, UUID studentId) {
        requireTeacher(teacher);
        requireStudent(teacher.id(), studentId);
        LessonHistoryEntry lesson = editable(teacher.id(), eventId);
        Set<UUID> roster = new LinkedHashSet<>(lesson.toResponse().participantStudentIds());
        if (roster.add(studentId)) {
            lesson.replaceParticipants(new ArrayList<>(roster));
            history.save(lesson);
            log.info("Lesson participant added teacher={} event={} student={}", teacher.id(), eventId, studentId);
        }
        return list(teacher, eventId);
    }

    @Transactional
    public List<Participant> remove(AuthenticatedUser teacher, String eventId, UUID studentId) {
        requireTeacher(teacher);
        LessonHistoryEntry lesson = editable(teacher.id(), eventId);
        Set<UUID> roster = new LinkedHashSet<>(lesson.toResponse().participantStudentIds());
        if (roster.remove(studentId)) {
            lesson.replaceParticipants(new ArrayList<>(roster));
            history.save(lesson);
            log.info("Lesson participant removed teacher={} event={} student={}", teacher.id(), eventId, studentId);
        }
        return list(teacher, eventId);
    }

    /** All-or-nothing transfer between occurrences owned by the same teacher. */
    @Transactional
    public void transfer(AuthenticatedUser teacher, String sourceEventId, String targetEventId, UUID studentId) {
        requireTeacher(teacher);
        if (sourceEventId == null || targetEventId == null || sourceEventId.equals(targetEventId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose two different lessons");
        }
        requireStudent(teacher.id(), studentId);
        // Stable lock order prevents opposite transfers from deadlocking.
        boolean sourceFirst = sourceEventId.compareTo(targetEventId) < 0;
        LessonHistoryEntry first = editable(teacher.id(), sourceFirst ? sourceEventId : targetEventId);
        LessonHistoryEntry second = editable(teacher.id(), sourceFirst ? targetEventId : sourceEventId);
        LessonHistoryEntry source = sourceFirst ? first : second;
        LessonHistoryEntry target = sourceFirst ? second : first;
        Set<UUID> from = new LinkedHashSet<>(source.toResponse().participantStudentIds());
        Set<UUID> to = new LinkedHashSet<>(target.toResponse().participantStudentIds());
        if (!from.remove(studentId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Student is not in source lesson");
        }
        to.add(studentId);
        source.replaceParticipants(new ArrayList<>(from));
        target.replaceParticipants(new ArrayList<>(to));
        history.save(source);
        history.save(target);
        log.info("Lesson participant transferred teacher={} student={} from={} to={}",
                teacher.id(), studentId, sourceEventId, targetEventId);
    }

    private LessonHistoryEntry editable(UUID teacherId, String eventId) {
        LessonHistoryEntry lesson = history.findLockedByTeacherIdAndEventId(teacherId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        // Never claim a pupil was removed from an already active LiveKit room.
        if (!Instant.now().isBefore(lesson.getStartsAt())
                || rooms.findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(teacherId, eventId)
                    .stream().anyMatch(room -> room.getStatus() != OnlineClassStatus.SCHEDULED
                            && room.getStatus() != OnlineClassStatus.CANCELLED)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Edit participants before the lesson opens; an active or completed room cannot be changed");
        }
        return lesson;
    }

    private LessonHistoryEntry requireLesson(UUID teacherId, String eventId) {
        if (eventId == null || eventId.isBlank()) throw new ResourceNotFoundException("Lesson not found");
        return history.findByTeacherIdAndEventId(teacherId, eventId)
                .filter(lesson -> lesson.getDeletedAt() == null)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
    }

    private boolean activeStudent(UUID teacherId, UUID studentId) {
        return studentId != null && users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
                studentId, teacherId, Role.STUDENT, UserStatus.ACTIVE);
    }

    private void requireStudent(UUID teacherId, UUID studentId) {
        if (!activeStudent(teacherId, studentId)) throw new ResourceNotFoundException("Student not found");
    }

    private void requireTeacher(AuthenticatedUser teacher) {
        if (teacher == null || teacher.role() != Role.TEACHER
                || !users.existsByIdAndRoleAndStatusAndArchivedFalse(
                        teacher.id(), Role.TEACHER, UserStatus.ACTIVE)) {
            throw new ResourceNotFoundException("Teacher not found");
        }
    }
}
