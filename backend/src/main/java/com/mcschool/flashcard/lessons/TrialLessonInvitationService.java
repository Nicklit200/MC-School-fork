package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.JwtService;
import com.mcschool.flashcard.auth.dto.AuthResponse;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import com.mcschool.flashcard.users.UserStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * One named visitor for one teacher-owned native trial lesson. The public
 * capability never authenticates a teacher, grants general student access or
 * accepts room IDs supplied by the visitor.
 */
@Service
public class TrialLessonInvitationService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration EARLY_JOIN = Duration.ofHours(1);
    private static final Duration END_GRACE = Duration.ofMinutes(60);
    private final JdbcTemplate jdbc;
    private final LessonHistoryRepository lessons;
    private final OnlineClassService classes;
    private final OnlineClassRepository classRepository;
    private final UserRepository users;
    private final ManualLessonService manualLessons;
    private final JwtService jwt;

    public TrialLessonInvitationService(JdbcTemplate jdbc, LessonHistoryRepository lessons,
                                       OnlineClassService classes, OnlineClassRepository classRepository,
                                       UserRepository users, ManualLessonService manualLessons, JwtService jwt) {
        this.jdbc = jdbc;
        this.lessons = lessons;
        this.classes = classes;
        this.classRepository = classRepository;
        this.users = users;
        this.manualLessons = manualLessons;
        this.jwt = jwt;
    }

    public record Created(String token, UUID classId, Instant expiresAt) {}
    public record InvitationInfo(String title, Instant startsAt, Instant endsAt,
                                 boolean canJoin, boolean claimed) {}
    public record Joined(AuthResponse auth, UUID classId) {}
    private record Invite(UUID teacherId, String eventId, UUID classId,
                          Instant expiresAt, UUID guestId, boolean revoked) {}

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception unavailable) { throw new IllegalStateException("SHA-256 not available", unavailable); }
    }
    private static String freshToken() {
        byte[] secret = new byte[32];
        RANDOM.nextBytes(secret);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
    }
    private static boolean isTrial(String title) {
        return title != null && (title.startsWith("Пробный урок") || title.startsWith("Probeunterricht"));
    }

    private LessonHistoryEntry eligible(AuthenticatedUser teacher, String eventId) {
        if (teacher == null || teacher.role() != Role.TEACHER || !eventId.startsWith(ManualLessonService.EVENT_PREFIX)) {
            throw new ResourceNotFoundException("Trial lesson not found");
        }
        LessonHistoryEntry lesson = lessons.findByTeacherIdAndEventId(teacher.id(), eventId)
                .filter(entry -> entry.getDeletedAt() == null)
                .orElseThrow(() -> new ResourceNotFoundException("Trial lesson not found"));
        if (lesson.getGroupId() != null)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A group cannot use this trial link");
        return lesson;
    }

    @Transactional
    public Created issue(AuthenticatedUser teacher, String eventId) {
        LessonHistoryEntry lesson = eligible(teacher, eventId);
        if (Instant.now().isAfter(lesson.getEndsAt().plus(END_GRACE)))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This trial lesson has finished");
        // Creates (or reuses) the same teacher-only room the teacher uses for PDF preparation.
        var classInfo = classes.materializeFromCalendar(teacher, eventId);
        OnlineClass room = classRepository.findById(classInfo.id())
                .orElseThrow(() -> new ResourceNotFoundException("Classroom not found"));
        if (room.isTerminal() || (room.getStudent() != null
                && (!room.getStudent().isTrialGuest()
                    || !room.getStudent().getId().equals(lesson.getStudentId()))))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This classroom can no longer accept a guest");
        // Stable for this teacher, lesson and classroom: copying the link must not revoke it.
        String token = jwt.trialInvitationToken(teacher.id(), eventId, room.getId());
        String tokenHash = hash(token);
        Instant expiry = lesson.getEndsAt().plus(END_GRACE);
        int updated = jdbc.update("""
                INSERT INTO trial_lesson_invitations
                  (event_id, teacher_id, class_id, token_hash, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (teacher_id, event_id)
                DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
                              class_id = EXCLUDED.class_id
                WHERE trial_lesson_invitations.revoked_at IS NULL
                  AND (trial_lesson_invitations.guest_user_id IS NULL
                       OR trial_lesson_invitations.guest_user_id = (
                            SELECT student_id FROM online_classes WHERE id = EXCLUDED.class_id))
                  AND trial_lesson_invitations.class_id = EXCLUDED.class_id
                """, eventId, teacher.id(), room.getId(), tokenHash,
                java.sql.Timestamp.from(expiry));
        if (updated != 1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Invitation was revoked, the classroom changed, or a different student joined");
        return new Created(token, room.getId(), expiry);
    }

    @Transactional
    public void revoke(AuthenticatedUser teacher, String eventId) {
        eligible(teacher, eventId);
        jdbc.update("""
                UPDATE trial_lesson_invitations SET revoked_at = CURRENT_TIMESTAMP
                WHERE teacher_id = ? AND event_id = ?
                """, teacher.id(), eventId);
    }

    private Invite find(String token, boolean lock) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}"))
            throw new ResourceNotFoundException("Invitation not found");
        String query = """
                SELECT teacher_id, event_id, class_id, expires_at, guest_user_id, revoked_at
                FROM trial_lesson_invitations WHERE token_hash = ?
                """ + (lock ? " FOR UPDATE" : "");
        return jdbc.query(query, (rs, i) -> new Invite(
                rs.getObject("teacher_id", UUID.class),
                rs.getString("event_id"),
                rs.getObject("class_id", UUID.class),
                rs.getTimestamp("expires_at").toInstant(),
                rs.getObject("guest_user_id", UUID.class),
                rs.getTimestamp("revoked_at") != null), hash(token))
                .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Invitation not found"));
    }

    private LessonHistoryEntry validate(Invite invite) {
        if (invite.revoked() || !Instant.now().isBefore(invite.expiresAt()))
            throw new ResourceNotFoundException("Invitation expired or revoked");
        LessonHistoryEntry lesson = lessons.findByTeacherIdAndEventId(invite.teacherId(), invite.eventId())
                .filter(entry -> entry.getDeletedAt() == null)
                .orElseThrow(() -> new ResourceNotFoundException("Invitation not found"));
        OnlineClass room = classRepository.findById(invite.classId())
                .filter(candidate -> !candidate.isTerminal()
                        && candidate.getTeacher().getId().equals(invite.teacherId())
                        && candidate.getEventId().equals(invite.eventId()))
                .orElseThrow(() -> new ResourceNotFoundException("Classroom not available"));
        if (lesson.getStudentId() != null && !lesson.getStudentId().equals(invite.guestId()))
            throw new ResourceNotFoundException("Invitation not available");
        if (room.getGroup() != null
                || (invite.guestId() == null && room.getStudent() != null)
                || (invite.guestId() != null
                    && (room.getStudent() == null
                        || !invite.guestId().equals(room.getStudent().getId()))))
            throw new ResourceNotFoundException("Invitation not available");
        return lesson;
    }

    @Transactional(readOnly = true)
    public InvitationInfo info(String token) {
        Invite invite = find(token, false);
        LessonHistoryEntry lesson = validate(invite);
        Instant now = Instant.now();
        return new InvitationInfo("Пробный урок Mindcrafti", lesson.getStartsAt(), lesson.getEndsAt(),
                !now.isBefore(lesson.getStartsAt().minus(EARLY_JOIN)),
                invite.guestId() != null);
    }

    @Transactional
    public Joined claim(String token, String name) {
        if (name == null || name.trim().length() < 2 || name.trim().length() > 80
                || name.chars().anyMatch(Character::isISOControl))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a name (2–80 characters)");
        Invite invite = find(token, true);
        LessonHistoryEntry lesson = validate(invite);
        Instant now = Instant.now();
        if (now.isBefore(lesson.getStartsAt().minus(EARLY_JOIN)))
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "You can enter up to 60 minutes before the trial lesson");
        if (invite.guestId() != null) {
            User returning = users.findById(invite.guestId())
                    .filter(User::isTrialGuest)
                    .filter(user -> !user.isArchived() && user.getStatus() == UserStatus.ACTIVE)
                    .orElseThrow(() -> new ResourceNotFoundException("Guest no longer available"));
            if (!returning.getFullName().equalsIgnoreCase(name.trim()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Please enter the same name you used for the first visit");
            return new Joined(guestAuth(returning, invite), invite.classId());
        }
        if (lesson.getStudentId() != null)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This trial is already assigned");
        var teacher = users.findById(invite.teacherId())
                .filter(u -> u.getRole() == Role.TEACHER && !u.isArchived()
                        && u.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Teacher unavailable"));
        // A guest has no username, email or password and is not a normal student account.
        User guest = users.saveAndFlush(User.trialGuest(name.trim(), teacher));
        AuthenticatedUser teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.TEACHER);
        manualLessons.bindStudent(teacherPrincipal, lesson.getEventId(), guest.getId());
        OnlineClass room = classRepository.findForUpdate(invite.classId())
                .orElseThrow(() -> new ResourceNotFoundException("Classroom not available"));
        if (!room.isTeacherOnly() || room.isTerminal())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The trial is no longer available");
        room.promoteToStudent(guest);
        jdbc.update("""
                UPDATE trial_lesson_invitations
                SET guest_user_id = ?, claimed_at = CURRENT_TIMESTAMP
                WHERE token_hash = ? AND guest_user_id IS NULL AND revoked_at IS NULL
                """, guest.getId(), hash(token));
        return new Joined(guestAuth(guest, invite), room.getId());
    }
    private AuthResponse guestAuth(User guest, Invite invite) {
        Instant now = Instant.now();
        Instant expiry = invite.expiresAt().isBefore(now.plus(Duration.ofHours(4)))
                ? invite.expiresAt() : now.plus(Duration.ofHours(4));
        return AuthResponse.bearer(
                jwt.generateTrialToken(guest, invite.classId(), expiry), expiry, UserResponse.from(guest));
    }
}
