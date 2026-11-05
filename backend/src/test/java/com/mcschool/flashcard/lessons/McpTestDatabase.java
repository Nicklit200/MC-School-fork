package com.mcschool.flashcard.lessons;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/** Dedicated local PostgreSQL for Windows review; Docker remains the CI default. */
final class McpTestDatabase {
    private static PostgreSQLContainer<?> database;
    private McpTestDatabase() {}

    static boolean available() {
        return externalUrl() != null || DockerClientFactory.instance().isDockerAvailable();
    }

    static synchronized void properties(DynamicPropertyRegistry properties) {
        String external = externalUrl();
        if (external != null) {
            // These tests truncate fixtures. Never accept an arbitrary production URL.
            if (!external.matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/mch3_pdf_test[a-zA-Z0-9_]*")) {
                throw new IllegalStateException("Use a dedicated local mch3_pdf_test database");
            }
            properties.add("spring.datasource.url", () -> external);
            properties.add("spring.datasource.username", () -> environment("MCH3_TEST_DATABASE_USER", "postgres"));
            properties.add("spring.datasource.password", () -> environment("MCH3_TEST_DATABASE_PASSWORD", ""));
        } else {
            if (database == null) {
                database = new PostgreSQLContainer<>("postgres:17-alpine");
                database.start();
            }
            properties.add("spring.datasource.url", database::getJdbcUrl);
            properties.add("spring.datasource.username", database::getUsername);
            properties.add("spring.datasource.password", database::getPassword);
        }
        properties.add("spring.datasource.hikari.maximum-pool-size", () -> 3);
        properties.add("spring.datasource.hikari.minimum-idle", () -> 0);
    }

    static synchronized void stop() {
        if (database != null) {
            database.stop();
            database = null;
        }
    }

    private static String externalUrl() {
        String value = System.getenv("MCH3_TEST_DATABASE_URL");
        return value == null || value.isBlank() ? null : value;
    }

    private static String environment(String name, String fallback) {
        String value = System.getenv(name);
        return value == null ? fallback : value;
    }
}
