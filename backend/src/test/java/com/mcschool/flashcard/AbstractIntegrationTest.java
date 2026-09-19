package com.mcschool.flashcard;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for integration tests. Starts one shared PostgreSQL container for the
 * whole test run (singleton pattern) so all tests hit a real PostgreSQL with the
 * Flyway-migrated schema. Requires Docker.
 *
 * <p>Because the container is shared, every test starts from a clean database:
 * {@link #resetDatabase()} truncates all tables before each test. It runs before
 * any subclass {@code @BeforeEach}, so subclasses can seed their own fixtures.
 */
@SpringBootTest
@AutoConfigureMockMvc
public abstract class AbstractIntegrationTest {

    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);

        // Each distinct @TestPropertySource creates its own Spring context, and
        // every context opens a pool against this one shared container. Spring
        // caches contexts rather than closing them, so with the default pool
        // size enough contexts exhaust PostgreSQL's max_connections and later
        // tests fail with "sorry, too many clients already" — a harness limit,
        // not an application fault. Integration tests are single-threaded per
        // context, so a small pool is ample.
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 2);
        registry.add("spring.datasource.hikari.minimum-idle", () -> 0);
    }

    @BeforeEach
    void cleanDatabaseBeforeEachTest() {
        jdbcTemplate.execute(
                "TRUNCATE TABLE daily_review_history, study_session_items, study_sessions, cards, homeworks, users "
                        + "RESTART IDENTITY CASCADE");
    }
}
