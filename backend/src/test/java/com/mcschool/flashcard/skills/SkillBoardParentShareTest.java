package com.mcschool.flashcard.skills;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.config.JwtProperties;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

class SkillBoardParentShareTest {

    private JdbcTemplate jdbc;
    private SkillProgressShareService shares;
    private UUID adminId;
    private UUID studentId;

    @BeforeEach
    void setup() throws Exception {
        String url = System.getenv("SKILLS_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && url.startsWith("jdbc:postgresql://localhost:"),
                "Only runs against the explicitly configured local CI test database");
        jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "skills_test", "skills_test"));

        jdbc.execute("""
            DROP TABLE IF EXISTS skill_progress_shares;
            DROP TABLE IF EXISTS student_skill_mastery_history;
            DROP TABLE IF EXISTS student_skill_mastery;
            DROP TABLE IF EXISTS skill_board_revisions;
            DROP TABLE IF EXISTS skill_boards;
            DROP TABLE IF EXISTS users;
            CREATE TABLE users (id UUID PRIMARY KEY);
            """);
        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/V65__add_skill_boards.sql")));

        User teacher = User.activeTeacher("Teacher", "teacher@example.test", "teacher", "hash");
        User student = User.managedStudent("Test Pupil", teacher);
        student.changeLearningProfile(6, "WIRTSCHAFTSSCHULE", null, null, null, null, null);
        studentId = student.getId();
        adminId = UUID.randomUUID();

        jdbc.update("INSERT INTO users(id) VALUES (?), (?)", adminId, studentId);
        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/V94__skill_progress_parent_shares.sql")));
        jdbc.execute("""
            CREATE TABLE student_skill_mastery (
                student_id UUID NOT NULL,
                board_id VARCHAR(64) NOT NULL,
                skill_id VARCHAR(128) NOT NULL,
                mastery INTEGER NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_by UUID,
                PRIMARY KEY(student_id, board_id, skill_id)
            );
            CREATE TABLE student_skill_mastery_history (
                id BIGSERIAL PRIMARY KEY,
                student_id UUID NOT NULL,
                board_id VARCHAR(64) NOT NULL,
                skill_id VARCHAR(128) NOT NULL,
                previous_mastery INTEGER NOT NULL,
                mastery INTEGER NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_by UUID
            );
            """);
        jdbc.update("""
            INSERT INTO student_skill_mastery(student_id, board_id, skill_id, mastery, updated_by)
            VALUES (?, 'grade-6', 'skill-1-1', 80, ?)
            """, studentId, adminId);
        jdbc.update("""
            INSERT INTO student_skill_mastery_history(
                student_id, board_id, skill_id, previous_mastery, mastery, updated_by
            ) VALUES (?, 'grade-6', 'skill-1-1', 20, 80, ?)
            """, studentId, adminId);

        UserRepository users = mock(UserRepository.class);
        when(users.findById(studentId)).thenReturn(Optional.of(student));

        SkillBoardService boards = new SkillBoardService(jdbc, JsonMapper.builder().build());
        shares = new SkillProgressShareService(
                jdbc,
                users,
                boards,
                new JwtProperties("test-only-parent-share-secret-1234567890-secure", 60));
    }

    @Test
    void linkIsOpaqueStableRevocableAndCanBeReissued() {
        AuthenticatedUser admin = new AuthenticatedUser(adminId, "admin@example.test", Role.ADMIN);

        String first = shares.enable("grade-6", studentId, admin).token();
        String repeated = shares.enable("grade-6", studentId, admin).token();
        assertEquals(first, repeated, "Copying the same active share should keep the same URL");

        String payload = new String(
                Base64.getUrlDecoder().decode(first.substring(0, first.indexOf('.'))),
                StandardCharsets.UTF_8);
        assertEquals(2, payload.split("\\n", -1).length);
        assertFalse(payload.contains(studentId.toString()), "Public token must not expose the pupil UUID");

        var publicProgress = shares.read(first);
        assertEquals("Test Pupil", publicProgress.student().fullName());
        assertEquals(80, publicProgress.mastery().get("skill-1-1"));
        assertEquals(1, publicProgress.history().size());
        assertEquals(20, publicProgress.history().get(0).previousMastery());
        assertEquals(80, publicProgress.history().get(0).mastery());
        assertTrue(publicProgress.totalSkills() > 0);
        assertEquals(1, publicProgress.assessedSkills());

        shares.revoke("grade-6", studentId, admin);
        ResponseStatusException revoked = assertThrows(ResponseStatusException.class, () -> shares.read(first));
        assertEquals(404, revoked.getStatusCode().value());

        String reissued = shares.enable("grade-6", studentId, admin).token();
        assertNotEquals(first, reissued, "Reissuing after revoke must invalidate the old bearer URL");
        assertEquals("Test Pupil", shares.read(reissued).student().fullName());
        assertThrows(ResponseStatusException.class,
                () -> shares.read(reissued.substring(0, reissued.length() - 1) + "A"));
    }
}
