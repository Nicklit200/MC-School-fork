package com.mcschool.flashcard.lessonboard;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.lessons.LessonHistoryEntry;
import com.mcschool.flashcard.lessons.LessonHistoryRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Standalone pilot whiteboard for an existing Google Calendar lesson.
 *
 * This deliberately does not change scheduling, Meet, attendance, homework or
 * PDF preparation. The global security filter restricts all endpoints to the
 * designated pilot teacher and his enrolled students, and this controller
 * additionally checks membership in the exact lesson occurrence.
 */
@RestController
@RequestMapping("/api/v1/lesson-board")
@PreAuthorize("hasAnyRole('TEACHER', 'STUDENT')")
public class LessonBoardController {

    private final LessonBoardOperationRepository operations;
    private final LessonHistoryRepository lessons;
    private final StudentGroupMemberRepository groupMembers;
    private final UserRepository users;
    private final ObjectMapper mapper;

    public LessonBoardController(LessonBoardOperationRepository operations,
                                 LessonHistoryRepository lessons,
                                 StudentGroupMemberRepository groupMembers,
                                 UserRepository users,
                                 ObjectMapper mapper) {
        this.operations = operations;
        this.lessons = lessons;
        this.groupMembers = groupMembers;
        this.users = users;
        this.mapper = mapper;
    }

    public record BoardPoint(Double x, Double y) {}
    public record BoardActionRequest(String kind, List<BoardPoint> points, Double x,
                                     Double y, String text, String color,
                                     Integer width, Long targetId) {}
    public record BoardOperationView(long id, String kind, String payload, UUID actorId,
                                     Instant createdAt) {
        static BoardOperationView of(LessonBoardOperation op) {
            return new BoardOperationView(op.getId(), op.getKind(), op.getPayload(),
                    op.getActorId(), op.getCreatedAt());
        }
    }
    public record BoardSnapshot(String title, String eventId, boolean teacher,
                                String meetUrl, List<BoardOperationView> operations) {}

    @GetMapping("/{eventId}")
    public BoardSnapshot read(@AuthenticationPrincipal AuthenticatedUser caller,
                              @PathVariable String eventId,
                              @RequestParam(defaultValue = "0") long after) {
        LessonHistoryEntry lesson = requireLesson(caller, eventId);
        UUID teacherId = lesson.getTeacher().getId();
        if (caller.role() == Role.STUDENT && !operations.existsByTeacherIdAndEventIdAndKind(
                teacherId, eventId, "OPEN")) {
            throw new ResourceNotFoundException("Board is not open yet");
        }
        if (after < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid cursor");
        String meetUrl = lesson.getMeetUrl();
        if (meetUrl != null) {
            meetUrl = meetUrl.replaceAll("([?&])authuser=[^&]*&?", "$1")
                    .replace("?&", "?").replaceAll("[?&]$", "");
        }
        return new BoardSnapshot(
                lesson.getTitle(), eventId, caller.role() == Role.TEACHER, meetUrl,
                operations.findTop300ByTeacherIdAndEventIdAndIdGreaterThanOrderByIdAsc(
                                teacherId, eventId, after).stream()
                        .map(BoardOperationView::of).toList());
    }

    /** Called only when the pilot teacher opens the board from a lesson card. */
    @PostMapping("/{eventId}/start")
    @PreAuthorize("hasRole('TEACHER')")
    public BoardSnapshot start(@AuthenticationPrincipal AuthenticatedUser caller,
                               @PathVariable String eventId) {
        requireLesson(caller, eventId);
        if (!operations.existsByTeacherIdAndEventIdAndKind(caller.id(), eventId, "OPEN")) {
            operations.save(LessonBoardOperation.create(
                    caller.id(), eventId, caller.id(), "OPEN", "{}"));
        }
        return read(caller, eventId, 0);
    }

    @PostMapping("/{eventId}/actions")
    public BoardOperationView append(@AuthenticationPrincipal AuthenticatedUser caller,
                                     @PathVariable String eventId,
                                     @RequestBody BoardActionRequest request) {
        LessonHistoryEntry lesson = requireLesson(caller, eventId);
        UUID teacherId = lesson.getTeacher().getId();
        if (!operations.existsByTeacherIdAndEventIdAndKind(teacherId, eventId, "OPEN")) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Board is not open");
        }
        validate(request, caller, teacherId, eventId);
        String payload = mapper.writeValueAsString(request);
        if (payload.length() > 16000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Action too large");
        }
        return BoardOperationView.of(operations.save(LessonBoardOperation.create(
                teacherId, eventId, caller.id(), request.kind(), payload)));
    }

    private LessonHistoryEntry requireLesson(AuthenticatedUser caller, String eventId) {
        if (eventId == null || eventId.isBlank() || eventId.length() > 255) {
            throw new ResourceNotFoundException("Lesson not found");
        }
        UUID teacherId = caller.id();
        if (caller.role() == Role.STUDENT) {
            User student = users.findById(caller.id())
                    .filter(u -> u.getRole() == Role.STUDENT && !u.isArchived())
                    .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
            if (student.getTeacher() == null) {
                throw new ResourceNotFoundException("Lesson not found");
            }
            teacherId = student.getTeacher().getId();
        } else if (caller.role() != Role.TEACHER) {
            throw new ResourceNotFoundException("Lesson not found");
        }
        LessonHistoryEntry lesson = lessons.findByTeacherIdAndEventId(teacherId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson not found"));
        if (caller.role() == Role.STUDENT) {
            boolean assigned = caller.id().equals(lesson.getStudentId())
                    || (lesson.getGroupId() != null
                    && groupMembers.existsByGroupIdAndStudentId(
                            lesson.getGroupId(), caller.id()));
            if (!assigned) throw new ResourceNotFoundException("Lesson not found");
        }
        return lesson;
    }

    private void validate(BoardActionRequest request, AuthenticatedUser caller,
                          UUID teacherId, String eventId) {
        if (request == null || request.kind() == null) invalid("Missing action");
        String kind = request.kind();
        if (!List.of("STROKE", "ERASE", "TEXT", "CLEAR", "UNDO").contains(kind)) {
            invalid("Unsupported action");
        }
        if (kind.equals("CLEAR") && caller.role() != Role.TEACHER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Teacher action only");
        }
        if (kind.equals("UNDO")) {
            LessonBoardOperation target = request.targetId() == null
                    ? null : operations.findById(request.targetId()).orElse(null);
            if (target == null || !teacherId.equals(target.getTeacherId())
                    || !eventId.equals(target.getEventId())
                    || !List.of("STROKE", "ERASE", "TEXT").contains(target.getKind())
                    || (caller.role() != Role.TEACHER
                    && !caller.id().equals(target.getActorId()))) {
                invalid("Invalid undo target");
            }
            return;
        }
        if (kind.equals("CLEAR")) return;
        if (request.color() == null
                || !request.color().matches("#[0-9a-fA-F]{6}")) {
            invalid("Invalid color");
        }
        if (request.width() == null || request.width() < 1 || request.width() > 48) {
            invalid("Invalid width");
        }
        if (kind.equals("TEXT")) {
            coordinate(request.x());
            coordinate(request.y());
            if (request.text() == null || request.text().isBlank()
                    || request.text().length() > 240) invalid("Invalid text");
            return;
        }
        if (request.points() == null || request.points().isEmpty()
                || request.points().size() > 500) invalid("Invalid points");
        for (BoardPoint point : request.points()) {
            if (point == null) invalid("Invalid point");
            coordinate(point.x());
            coordinate(point.y());
        }
    }

    private void coordinate(Double value) {
        if (value == null || !Double.isFinite(value)
                || value < 0 || value > 1) invalid("Invalid position");
    }

    private void invalid(String message) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
