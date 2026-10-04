package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SkillMasteryService {
    public record StudentOption(UUID id, String fullName, Integer grade, String schoolType) {}
    public record MasterySnapshot(UUID studentId, String studentName, Map<String,Integer> mastery, Instant updatedAt) {}
    public record UpdateRequest(int mastery) {}

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final SkillBoardService boards;

    public SkillMasteryService(JdbcTemplate jdbc, UserRepository users, SkillBoardService boards) {
        this.jdbc = jdbc;
        this.users = users;
        this.boards = boards;
    }

    @Transactional(readOnly = true)
    public List<StudentOption> listStudents(AuthenticatedUser caller) {
        requireReader(caller);
        List<User> visible;
        if (caller.role() == Role.ADMIN) {
            visible = users.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(Role.STUDENT, UserStatus.ACTIVE);
        } else {
            visible = users.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(caller.id(), Role.STUDENT)
                    .stream().filter(u -> u.getStatus() == UserStatus.ACTIVE).toList();
        }
        return visible.stream().map(u -> new StudentOption(u.getId(), u.getFullName(), u.getGrade(), u.getSchoolType())).toList();
    }

    @Transactional(readOnly = true)
    public MasterySnapshot get(String boardId, UUID studentId, AuthenticatedUser caller) {
        User student = requireVisibleStudent(caller, studentId);
        boards.get(boardId);
        LinkedHashMap<String,Integer> values = new LinkedHashMap<>();
        jdbc.query("""
            SELECT skill_id, mastery
            FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ?
            ORDER BY skill_id
            """, (rs, rowNum) -> Map.entry(rs.getString(1), rs.getInt(2)), studentId, boardId)
            .forEach(entry -> values.put(entry.getKey(), entry.getValue()));
        Instant updatedAt = jdbc.query("""
            SELECT max(updated_at) FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ?
            """, rs -> rs.next() && rs.getTimestamp(1) != null ? rs.getTimestamp(1).toInstant() : null, studentId, boardId);
        return new MasterySnapshot(studentId, student.getFullName(), values, updatedAt);
    }

    @Transactional
    public MasterySnapshot update(String boardId, UUID studentId, String skillId, int mastery, AuthenticatedUser caller) {
        if (mastery < 0 || mastery > 100) throw bad("Процент должен быть от 0 до 100");
        requireVisibleStudent(caller, studentId);
        SkillBoardService.Snapshot board = boards.get(boardId);
        boolean exists = board.data().nodes().stream()
                .anyMatch(n -> n.id().equals(skillId) && n.kind().equals("skill") && !n.archived());
        if (!exists) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Навык не найден или находится в архиве");
        jdbc.update("""
            INSERT INTO student_skill_mastery(student_id, board_id, skill_id, mastery, updated_at, updated_by)
            VALUES (?, ?, ?, ?, now(), ?)
            ON CONFLICT(student_id, board_id, skill_id)
            DO UPDATE SET mastery = excluded.mastery, updated_at = now(), updated_by = excluded.updated_by
            """, studentId, boardId, skillId, mastery, caller.id());
        return get(boardId, studentId, caller);
    }

    private User requireVisibleStudent(AuthenticatedUser caller, UUID studentId) {
        requireReader(caller);
        User student = users.findById(studentId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ученик не найден"));
        if (student.getRole() != Role.STUDENT || student.isArchived())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Ученик не найден");
        if (caller.role() == Role.TEACHER) {
            if (student.getTeacher() == null || !caller.id().equals(student.getTeacher().getId()))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Этот ученик относится к другому преподавателю");
        }
        return student;
    }

    private static void requireReader(AuthenticatedUser caller) {
        if (caller == null || caller.id() == null || (caller.role() != Role.ADMIN && caller.role() != Role.TEACHER))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Нужен вход администратора или преподавателя");
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
