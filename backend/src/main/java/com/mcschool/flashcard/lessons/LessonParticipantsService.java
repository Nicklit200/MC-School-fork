package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.JoinRequestState;
import com.mcschool.flashcard.liveclasses.OnlineClassJoinRequestRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassParticipant;
import com.mcschool.flashcard.liveclasses.OnlineClassParticipantRepository;
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
    private final OnlineClassParticipantRepository roomParticipants;
    private final OnlineClassJoinRequestRepository joinRequests;

    public LessonParticipantsService(LessonHistoryRepository history, UserRepository users,
                                     OnlineClassRepository rooms,
                                     OnlineClassParticipantRepository roomParticipants,
                                     OnlineClassJoinRequestRepository joinRequests) {
        this.history = history;
        this.users = users;
        this.rooms = rooms;
        this.roomParticipants = roomParticipants;
        this.joinRequests = joinRequests;
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
        LessonHistoryEntry lesson = editableForAdd(teacher.id(), eventId);
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
        LessonHistoryEntry lesson = history.findLockedByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        List<OnlineClass> lessonRooms = editableRooms(teacher.id(), eventId, lesson);
        Set<UUID> roster = new LinkedHashSet<>(lesson.toResponse().participantStudentIds());
        if (roster.remove(studentId)) {
            lesson.replaceParticipants(new ArrayList<>(roster));
            history.save(lesson);
            revokePendingRoomAccess(lessonRooms, studentId, Instant.now());
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
        LessonHistoryEntry first = history.findLockedByTeacherIdAndEventId(
                        teacher.id(), sourceFirst ? sourceEventId : targetEventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        LessonHistoryEntry second = history.findLockedByTeacherIdAndEventId(
                        teacher.id(), sourceFirst ? targetEventId : sourceEventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        List<OnlineClass> firstRooms = editableRooms(
                teacher.id(), sourceFirst ? sourceEventId : targetEventId, first);
        List<OnlineClass> secondRooms = editableRooms(
                teacher.id(), sourceFirst ? targetEventId : sourceEventId, second);
        LessonHistoryEntry source = sourceFirst ? first : second;
        LessonHistoryEntry target = sourceFirst ? second : first;
        List<OnlineClass> sourceRooms = sourceFirst ? firstRooms : secondRooms;
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
        revokePendingRoomAccess(sourceRooms, studentId, Instant.now());
        log.info("Lesson participant transferred teacher={} student={} from={} to={}",
                teacher.id(), studentId, sourceEventId, targetEventId);
    }

    /**
     * Adding a pupil is safe while the room is open: the occurrence roster is
     * the live admission source used by OnlineClassAccessService, so the new
     * pupil can request entry to this same room (and the waiting room still
     * applies). Removing or transferring a pupil remains restricted to before
     * the room opens because an already connected LiveKit participant must be
     * explicitly removed from the media room as well.
     */
    private LessonHistoryEntry editableForAdd(UUID teacherId, String eventId) {
        LessonHistoryEntry lesson = history.findLockedByTeacherIdAndEventId(teacherId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        OnlineClass room = rooms.findFirstByTeacherIdAndEventIdOrderByCreatedAtDesc(teacherId, eventId)
                .orElse(null);
        boolean roomOpen = room != null && room.isConnectable();
        boolean roomEnded = room != null && room.getStatus() == OnlineClassStatus.ENDED;
        if (roomEnded || (!Instant.now().isBefore(lesson.getStartsAt()) && !roomOpen)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A pupil can be added before the lesson starts or while its classroom is open");
        }
        return lesson;
    }

    /**
     * A classroom can be opened before its scheduled lesson time so the teacher can
     * test the room and the waiting-room window can be prepared. That early LIVE
     * state must not lock the occurrence roster when no pupil has ever received a
     * connection. Once a pupil has received a connection, or the scheduled start
     * has arrived, changing the roster could falsify attendance or leave a live
     * participant in the room and is therefore rejected.
     */
    private List<OnlineClass> editableRooms(UUID teacherId, String eventId, LessonHistoryEntry lesson) {
        Instant now = Instant.now();
        if (!now.isBefore(lesson.getStartsAt())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Edit participants before the scheduled lesson start");
        }

        List<OnlineClass> found = rooms.findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(teacherId, eventId);
        // Lock every materialized room in a stable order so opening/joining a room
        // cannot race with a roster edit.
        List<OnlineClass> lockedRooms = found.stream()
                .sorted(Comparator.comparing(room -> room.getId().toString()))
                .map(room -> rooms.findForUpdate(room.getId()).orElse(room))
                .toList();

        for (OnlineClass room : lockedRooms) {
            OnlineClassStatus status = room.getStatus();
            if (status == OnlineClassStatus.SCHEDULED || status == OnlineClassStatus.CANCELLED) {
                continue;
            }
            boolean preopenedEmptyRoom = (status == OnlineClassStatus.LOBBY_OPEN || status == OnlineClassStatus.LIVE)
                    && room.getScheduledStartAt() != null
                    && now.isBefore(room.getScheduledStartAt())
                    && !hasStudentEverEntered(room);
            if (!preopenedEmptyRoom) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Participants can only be changed before a pupil enters the classroom and before the scheduled start");
            }
        }
        return lockedRooms;
    }

    private boolean hasStudentEverEntered(OnlineClass room) {
        return roomParticipants.findAllByOnlineClassIdOrderByCreatedAtAsc(room.getId()).stream()
                .anyMatch(participant -> !participant.isHost() && participant.getFirstJoinedAt() != null);
    }

    /** Revoke any not-yet-connected waiting-room access after removing this occurrence's roster entry. */
    private void revokePendingRoomAccess(List<OnlineClass> lessonRooms, UUID studentId, Instant now) {
        for (OnlineClass room : lessonRooms) {
            roomParticipants.findByOnlineClassIdAndUserId(room.getId(), studentId)
                    .ifPresent(OnlineClassParticipant::remove);
            joinRequests.findByOnlineClassIdAndUserIdAndState(room.getId(), studentId, JoinRequestState.PENDING)
                    .ifPresent(request -> request.cancel(now));
        }
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
