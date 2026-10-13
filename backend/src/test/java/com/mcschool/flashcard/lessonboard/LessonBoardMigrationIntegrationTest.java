package com.mcschool.flashcard.lessonboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.mcschool.flashcard.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** Confirms the new board storage is compatible with the complete production Flyway history. */
class LessonBoardMigrationIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void boardTableExistsAfterAllProductionMigrations() {
        String table = jdbcTemplate.queryForObject(
                "SELECT to_regclass('public.lesson_board_operations')::text", String.class);
        assertEquals("lesson_board_operations", table);
        Integer indexes = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM pg_indexes WHERE tablename = 'lesson_board_operations'",
                Integer.class);
        assertNotNull(indexes);
        assertEquals(3, indexes.intValue());
    }
}
