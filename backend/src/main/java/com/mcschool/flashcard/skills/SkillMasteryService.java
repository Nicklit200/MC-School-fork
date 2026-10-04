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
import tools.jackson.databind.ObjectMapper;

@Service
public class SkillMasteryService {
    private static final Set<String> EVIDENCE_TYPES = Set.of(
            "homework", "card_session", "lesson_transcript", "manual_check", "assessment", "other");

    public record StudentOption(UUID id, String fullName) {}

    public record Evidence(
            String sourceType,
            String sourceId,
            String sourceTitle,
            String sourceDate,
            String link,
            String observation,
            String studentAnswer,
            String correctAnswer,
            String result,
            String impact) {}

    public record MasteryChange(
            long id,
            Integer oldMastery,
            int newMastery,
            String reason,
            List<Evidence> evidence,
            boolean manualOverride,
            Instant changedAt,
            UUID changedBy) {}

    public record MasterySnapshot(
            UUID studentId,
            String studentName,
            Map<String,Integer> mastery,
            Map<String,Boolean> evidenceVerified,
            Instant updatedAt) {}

    public record UpdateRequest(
            Integer mastery,
            String reason,
            List<Evidence> evidence,
            Boolean manualOverride) {}

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final SkillBoardService boards;
    private final ObjectMapper mapper;

    public SkillMasteryService(
            JdbcTemplate jdbc,
            UserRepository users,
            SkillBoardService boards,
            ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.users = users;
        this.boards = boards;
        this.mapper = mapper;
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
        return visible.stream().map(u -> new StudentOption(u.getId(), u.getFullName())).toList();
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

        LinkedHashMap<String,Boolean> evidenceVerified = new LinkedHashMap<>();
        jdbc.query("""
            SELECT DISTINCT ON (skill_id)
                   skill_id,
                   jsonb_array_length(evidence) > 0 AS has_evidence
            FROM student_skill_mastery_history
            WHERE student_id = ? AND board_id = ?
            ORDER BY skill_id, changed_at DESC, id DESC
            """, (rs, rowNum) -> Map.entry(rs.getString(1), rs.getBoolean(2)), studentId, boardId)
            .forEach(entry -> evidenceVerified.put(entry.getKey(), entry.getValue()));

        Instant updatedAt = jdbc.query("""
            SELECT max(updated_at) FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ?
            """, rs -> rs.next() && rs.getTimestamp(1) != null ? rs.getTimestamp(1).toInstant() : null, studentId, boardId);

        return new MasterySnapshot(studentId, student.getFullName(), values, evidenceVerified, updatedAt);
    }

    @Transactional(readOnly = true)
    public List<MasteryChange> history(
            String boardId, UUID studentId, String skillId, AuthenticatedUser caller) {
        requireVisibleStudent(caller, studentId);
        requireSkill(boardId, skillId);
        return jdbc.query("""
            SELECT id, old_mastery, new_mastery, reason, evidence::text,
                   manual_override, changed_at, changed_by
            FROM student_skill_mastery_history
            WHERE student_id = ? AND board_id = ? AND skill_id = ?
            ORDER BY changed_at DESC, id DESC
            """, (rs, rowNum) -> new MasteryChange(
                rs.getLong(1),
                rs.getObject(2) == null ? null : rs.getInt(2),
                rs.getInt(3),
                rs.getString(4),
                parseEvidence(rs.getString(5)),
                rs.getBoolean(6),
                rs.getTimestamp(7).toInstant(),
                rs.getObject(8, UUID.class)
            ), studentId, boardId, skillId);
    }

    @Transactional
    public MasterySnapshot update(
            String boardId,
            UUID studentId,
            String skillId,
            int mastery,
            String reason,
            List<Evidence> evidence,
            boolean manualOverride,
            AuthenticatedUser caller) {
        if (mastery < 0 || mastery > 100) throw bad("Процент должен быть от 0 до 100");
        requireVisibleStudent(caller, studentId);
        requireSkill(boardId, skillId);

        String cleanReason = reason == null ? "" : reason.trim();
        if (cleanReason.isBlank()) throw bad("Для изменения процента нужно объяснение");
        if (cleanReason.length() > 4000) throw bad("Объяснение слишком длинное");

        List<Evidence> cleanEvidence = normalizeEvidence(evidence);
        if (cleanEvidence.isEmpty() && !manualOverride)
            throw bad("Для изменения процента нужно хотя бы одно доказательство");
        if (cleanEvidence.isEmpty() && manualOverride && cleanReason.length() < 8)
            throw bad("Для ручного override подробно укажите причину");

        Integer oldMastery = jdbc.query("""
            SELECT mastery
            FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ? AND skill_id = ?
            """, (rs, rowNum) -> rs.getInt(1), studentId, boardId, skillId)
            .stream().findFirst().orElse(null);

        jdbc.update("""
            INSERT INTO student_skill_mastery(student_id, board_id, skill_id, mastery, updated_at, updated_by)
            VALUES (?, ?, ?, ?, now(), ?)
            ON CONFLICT(student_id, board_id, skill_id)
            DO UPDATE SET mastery = excluded.mastery, updated_at = now(), updated_by = excluded.updated_by
            """, studentId, boardId, skillId, mastery, caller.id());

        jdbc.update("""
            INSERT INTO student_skill_mastery_history(
                student_id, board_id, skill_id, old_mastery, new_mastery,
                reason, evidence, manual_override, changed_at, changed_by
            )
            VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, now(), ?)
            """,
            studentId, boardId, skillId, oldMastery, mastery,
            cleanReason, mapper.writeValueAsString(cleanEvidence), manualOverride, caller.id());

        return get(boardId, studentId, caller);
    }

    private SkillBoardService.Node requireSkill(String boardId, String skillId) {
        SkillBoardService.Snapshot board = boards.get(boardId);
        return board.data().nodes().stream()
                .filter(n -> n.id().equals(skillId) && n.kind().equals("skill") && !n.archived())
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Навык не найден или находится в архиве"));
    }

    private List<Evidence> normalizeEvidence(List<Evidence> evidence) {
        if (evidence == null) return List.of();
        ArrayList<Evidence> result = new ArrayList<>();
        for (Evidence item : evidence) {
            if (item == null) continue;
            String type = trim(item.sourceType());
            if (!EVIDENCE_TYPES.contains(type))
                throw bad("Неизвестный тип доказательства: " + type);
            String observation = trim(item.observation());
            if (observation.isBlank())
                throw bad("В каждом доказательстве укажите конкретное наблюдение");
            String sourceId = trim(item.sourceId());
            String sourceTitle = trim(item.sourceTitle());
            if (sourceId.isBlank() && sourceTitle.isBlank())
                throw bad("В каждом доказательстве нужен sourceId или sourceTitle");
            result.add(new Evidence(
                    type,
                    sourceId,
                    sourceTitle,
                    trim(item.sourceDate()),
                    trim(item.link()),
                    observation,
                    trim(item.studentAnswer()),
                    trim(item.correctAnswer()),
                    trim(item.result()),
                    trim(item.impact())));
        }
        if (result.size() > 30) throw bad("За одно изменение можно сохранить максимум 30 доказательств");
        return List.copyOf(result);
    }

    private List<Evidence> parseEvidence(String json) {
        if (json == null || json.isBlank() || json.equals("[]")) return List.of();
        try {
            Evidence[] parsed = mapper.readValue(json, Evidence[].class);
            return parsed == null ? List.of() : List.of(parsed);
        } catch (RuntimeException ex) {
            return List.of(new Evidence(
                    "other", "", "Повреждённая историческая запись", "", "",
                    "Не удалось прочитать сохранённые доказательства.", "", "", "", ""));
        }
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

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static void requireReader(AuthenticatedUser caller) {
        if (caller == null || caller.id() == null || (caller.role() != Role.ADMIN && caller.role() != Role.TEACHER))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Нужен вход администратора или преподавателя");
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
