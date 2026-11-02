package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.config.JwtProperties;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Persistent, revocable read-only links for a single pupil's skill map.
 * The database stores only a monotonically increasing version; bearer tokens
 * are deterministic HMACs and can therefore be copied again without storing
 * the credential itself.
 */
@Service
public class SkillProgressShareService {

    private static final String PURPOSE = "mindcrafti-skill-progress-share-v1";
    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final SkillBoardService boards;
    private final byte[] signingKey;

    public SkillProgressShareService(
            JdbcTemplate jdbc,
            UserRepository users,
            SkillBoardService boards,
            JwtProperties jwtProperties) {
        this.jdbc = jdbc;
        this.users = users;
        this.boards = boards;
        String secret = jwtProperties.secret();
        boolean secure = secret != null
                && secret.getBytes(StandardCharsets.UTF_8).length >= 32
                && !secret.startsWith("local-dev-only-");
        this.signingKey = secure ? hmac(secret.getBytes(StandardCharsets.UTF_8), PURPOSE) : null;
    }

    public record ShareToken(String token) {}
    public record PublicStudent(String fullName, Integer grade, String schoolType) {}
    public record PublicHistoryEntry(String skillId, int previousMastery, int mastery, Instant updatedAt) {}
    public record PublicProgress(
            String boardId,
            long boardRevision,
            Instant boardUpdatedAt,
            SkillBoardService.Board board,
            PublicStudent student,
            Map<String, Integer> mastery,
            List<PublicHistoryEntry> history,
            int overallPercent,
            int assessedSkills,
            int totalSkills,
            Instant updatedAt) {}

    @Transactional
    public ShareToken enable(String boardId, UUID studentId, AuthenticatedUser caller) {
        requireSigning();
        requireVisibleStudent(caller, studentId);
        boards.get(boardId);

        ShareRow row = jdbc.query("""
            SELECT version, enabled
            FROM skill_progress_shares
            WHERE student_id = ? AND board_id = ?
            FOR UPDATE
            """, rs -> rs.next() ? new ShareRow(rs.getLong("version"), rs.getBoolean("enabled")) : null,
            studentId, boardId);

        long version;
        if (row == null) {
            version = 1;
            jdbc.update("""
                INSERT INTO skill_progress_shares(
                    student_id, board_id, version, enabled, created_at, updated_at, created_by
                ) VALUES (?, ?, ?, TRUE, now(), now(), ?)
                """, studentId, boardId, version, caller.id());
        } else if (row.enabled()) {
            version = row.version();
            jdbc.update("""
                UPDATE skill_progress_shares
                SET updated_at = now(), created_by = ?
                WHERE student_id = ? AND board_id = ?
                """, caller.id(), studentId, boardId);
        } else {
            version = row.version() + 1;
            jdbc.update("""
                UPDATE skill_progress_shares
                SET version = ?, enabled = TRUE, updated_at = now(), created_by = ?
                WHERE student_id = ? AND board_id = ?
                """, version, caller.id(), studentId, boardId);
        }
        return new ShareToken(token(boardId, studentId, version));
    }

    @Transactional
    public void revoke(String boardId, UUID studentId, AuthenticatedUser caller) {
        requireVisibleStudent(caller, studentId);
        boards.get(boardId);
        jdbc.update("""
            UPDATE skill_progress_shares
            SET version = version + 1, enabled = FALSE, updated_at = now(), created_by = ?
            WHERE student_id = ? AND board_id = ?
            """, caller.id(), studentId, boardId);
    }

    @Transactional(readOnly = true)
    public PublicProgress read(String token) {
        requireSigning();
        Decoded decoded = decode(token);
        boolean enabled = Boolean.TRUE.equals(jdbc.query("""
            SELECT enabled
            FROM skill_progress_shares
            WHERE student_id = ? AND board_id = ? AND version = ?
            """, rs -> rs.next() ? rs.getBoolean("enabled") : null,
            decoded.studentId(), decoded.boardId(), decoded.version()));
        if (!enabled) throw notFound();

        User student = users.findById(decoded.studentId()).orElseThrow(SkillProgressShareService::notFound);
        if (student.getRole() != Role.STUDENT || student.isArchived() || student.getStatus() != UserStatus.ACTIVE)
            throw notFound();

        SkillBoardService.Snapshot board = boards.get(decoded.boardId());
        LinkedHashMap<String, Integer> mastery = new LinkedHashMap<>();
        jdbc.query("""
            SELECT skill_id, mastery
            FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ?
            ORDER BY skill_id
            """, (rs, rowNum) -> Map.entry(rs.getString("skill_id"), rs.getInt("mastery")),
            decoded.studentId(), decoded.boardId()).forEach(entry -> mastery.put(entry.getKey(), entry.getValue()));

        List<PublicHistoryEntry> history = jdbc.query("""
            SELECT skill_id, previous_mastery, mastery, updated_at
            FROM student_skill_mastery_history
            WHERE student_id = ? AND board_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 500
            """, (rs, rowNum) -> new PublicHistoryEntry(
                rs.getString("skill_id"),
                rs.getInt("previous_mastery"),
                rs.getInt("mastery"),
                rs.getTimestamp("updated_at").toInstant()),
            decoded.studentId(), decoded.boardId());

        Instant updatedAt = jdbc.query("""
            SELECT max(updated_at)
            FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ?
            """, rs -> rs.next() && rs.getTimestamp(1) != null ? rs.getTimestamp(1).toInstant() : null,
            decoded.studentId(), decoded.boardId());

        List<SkillBoardService.Node> relevant = relevantSkills(board.data(), student.getSchoolType());
        int totalSkills = relevant.size();
        int assessedSkills = (int) relevant.stream().filter(node -> mastery.containsKey(node.id())).count();
        int overallPercent = totalSkills == 0 ? 0 : (int) Math.round(
                relevant.stream().mapToInt(node -> clamp(mastery.getOrDefault(node.id(), 0))).average().orElse(0));

        return new PublicProgress(
                board.id(),
                board.revision(),
                board.updatedAt(),
                board.data(),
                new PublicStudent(student.getFullName(), student.getGrade(), student.getSchoolType()),
                Map.copyOf(mastery),
                List.copyOf(history),
                overallPercent,
                assessedSkills,
                totalSkills,
                updatedAt);
    }

    private List<SkillBoardService.Node> relevantSkills(SkillBoardService.Board board, String schoolType) {
        List<SkillBoardService.Node> skills = board.nodes().stream()
                .filter(node -> node.kind().equals("skill") && !node.archived())
                .toList();
        boolean configured = skills.stream().anyMatch(node ->
                Boolean.TRUE.equals(node.core())
                        || (node.schoolTypes() != null && !node.schoolTypes().isEmpty()));
        if (!configured) return skills;

        List<SkillBoardService.Node> relevant = new ArrayList<>();
        for (SkillBoardService.Node node : skills) {
            boolean core = Boolean.TRUE.equals(node.core());
            boolean school = schoolType != null
                    && node.schoolTypes() != null
                    && node.schoolTypes().contains(schoolType);
            if (core || school) relevant.add(node);
        }
        return relevant.isEmpty() ? skills : relevant;
    }

    private User requireVisibleStudent(AuthenticatedUser caller, UUID studentId) {
        if (caller == null || caller.id() == null
                || (caller.role() != Role.ADMIN && caller.role() != Role.TEACHER))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Нужен вход администратора или преподавателя");
        User student = users.findById(studentId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ученик не найден"));
        if (student.getRole() != Role.STUDENT || student.isArchived())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Ученик не найден");
        if (caller.role() == Role.TEACHER
                && (student.getTeacher() == null || !caller.id().equals(student.getTeacher().getId())))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Этот ученик относится к другому преподавателю");
        return student;
    }

    private String token(String boardId, UUID studentId, long version) {
        String payload = boardId + "\n" + studentId + "\n" + version;
        String encoded = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        String signature = Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(signingKey, payload));
        return encoded + "." + signature;
    }

    private Decoded decode(String token) {
        if (token == null || token.length() < 20 || token.length() > 512) throw notFound();
        String[] parts = token.split("\\.", -1);
        if (parts.length != 2 || !parts[0].matches("[A-Za-z0-9_-]+") || !parts[1].matches("[A-Za-z0-9_-]{43}"))
            throw notFound();
        String payload;
        try {
            payload = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            throw notFound();
        }
        String expected = Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(signingKey, payload));
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII),
                parts[1].getBytes(StandardCharsets.US_ASCII))) throw notFound();
        String[] fields = payload.split("\\n", -1);
        if (fields.length != 3 || !fields[0].matches("[A-Za-z0-9][A-Za-z0-9_-]{0,63}")) throw notFound();
        try {
            UUID studentId = UUID.fromString(fields[1]);
            long version = Long.parseLong(fields[2]);
            if (version < 1) throw notFound();
            return new Decoded(fields[0], studentId, version);
        } catch (IllegalArgumentException ex) {
            throw notFound();
        }
    }

    private void requireSigning() {
        if (signingKey == null)
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Публичные ссылки прогресса недоступны: безопасный ключ подписи не настроен");
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(100, value));
    }

    private static byte[] hmac(byte[] key, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Could not sign skill progress share token", ex);
        }
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Ссылка на прогресс недействительна");
    }

    private record ShareRow(long version, boolean enabled) {}
    private record Decoded(String boardId, UUID studentId, long version) {}
}
