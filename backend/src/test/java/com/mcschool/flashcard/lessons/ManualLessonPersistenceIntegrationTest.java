package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.CreateLessonRequest;
import com.mcschool.flashcard.lessons.dto.CreateLessonSeriesRequest;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Full migrated schema in a disposable database, with no developer-database fallback. */
@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class ManualLessonPersistenceIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private ManualLessonService service;
    @Autowired private GoogleCalendarLessonService calendar;
    @Autowired private LessonPreparationService preparations;
    @Autowired private LessonHistoryRepository history;
    @Autowired private UserRepository users;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private GoogleCalendarOAuthService oauth;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username", DATABASE::getUsername);
        properties.add("spring.datasource.password", DATABASE::getPassword);
    }

    private User teacher() {
        String suffix = UUID.randomUUID().toString();
        return users.save(User.activeTeacher("Native teacher", suffix + "@test.local", suffix, "unused-test-password-hash"));
    }

    private AuthenticatedUser caller(User user) { return new AuthenticatedUser(user.getId(), null, user.getRole()); }

    private CreateLessonSeriesRequest series(String title) {
        return new CreateLessonSeriesRequest(title, LocalDate.of(2026, 11, 5), 45,
                CreateLessonSeriesRequest.Period.TWO_WEEKS, Set.of(4), null, null);
    }

    @Test
    void nativeLessonsRebindWithoutStaleStudentAccessAndCoveredNotesPersist() {
        User teacher = teacher();
        var teacherCaller = caller(teacher);
        User previous = users.save(User.managedStudent("Previous pupil", teacher));
        User next = users.save(User.managedStudent("Next pupil", teacher));
        Instant start = Instant.parse("2026-11-05T23:00:00Z");
        GroupLessonResponse lesson = service.create(teacherCaller, new CreateLessonRequest(
                "Fractions", start, start.plusSeconds(2700), null, previous.getId()));
        assertThat(calendar.listStudentLessons(caller(previous))).extracting(GroupLessonResponse::eventId)
                .contains(lesson.eventId());
        service.bindStudent(teacherCaller, lesson.eventId(), next.getId());
        assertThat(calendar.listStudentLessons(caller(previous))).extracting(GroupLessonResponse::eventId)
                .doesNotContain(lesson.eventId());
        assertThat(calendar.listStudentLessons(caller(next))).extracting(GroupLessonResponse::eventId)
                .contains(lesson.eventId());
        when(oauth.accessTokenForTeacher(teacher.getId())).thenThrow(new IllegalStateException("Google connection expired"));
        assertThat(calendar.listGroupLessons(teacherCaller)).extracting(GroupLessonResponse::eventId)
                .contains(lesson.eventId());
        preparations.update(teacherCaller, lesson.eventId(), new UpdateLessonPreparationRequest(
                "Homework", "Difficulties", "Plan", "Transcript", "Fractions 1–5"));
        preparations.update(teacherCaller, lesson.eventId(), new UpdateLessonPreparationRequest(
                "New homework", "Difficulties", "Plan", "Transcript"));
        assertThat(preparations.getOrCreate(teacherCaller, lesson.eventId()).coveredMaterial()).isEqualTo("Fractions 1–5");
        assertThat(jdbc.queryForObject("select covered_material from lesson_preparations where teacher_id=? and event_id=?",
                String.class, teacher.getId(), lesson.eventId())).isEqualTo("Fractions 1–5");
        assertThat(jdbc.queryForObject("select count(*) from information_schema.tables where table_name in ('completed_lesson_documents','notebook_cameras')",
                Integer.class)).isEqualTo(2);
    }

    @Test
    void databaseFailureRollsBackTheEntireFiniteSeries() {
        User teacher = teacher();
        String title = "Atomic series " + UUID.randomUUID();
        // The first Thursday is valid; the second insert fails inside the same
        // transaction. No first lesson may survive that failure.
        jdbc.execute("ALTER TABLE lesson_history ADD CONSTRAINT native_series_atomic_test CHECK (title <> '"
                + title + "' OR starts_at < TIMESTAMPTZ '2026-11-11 23:00:00+00')");
        try {
            assertThatThrownBy(() -> service.createSeries(caller(teacher), series(title)))
                    .isInstanceOf(RuntimeException.class);
            assertThat(history.findAllByTeacherIdOrderByStartsAtAsc(teacher.getId())).isEmpty();
        } finally {
            jdbc.execute("ALTER TABLE lesson_history DROP CONSTRAINT native_series_atomic_test");
        }
    }

    @Test
    void concurrentSeriesKeepEveryOccurrenceAndDistinctEventIds() throws Exception {
        User teacher = teacher();
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.Callable<List<GroupLessonResponse>> create = () -> {
                if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrent start timed out");
                return service.createSeries(caller(teacher), series("Parallel series"));
            };
            var first = executor.submit(create);
            var second = executor.submit(create);
            start.countDown();
            assertThat(first.get(20, TimeUnit.SECONDS)).hasSize(2);
            assertThat(second.get(20, TimeUnit.SECONDS)).hasSize(2);
            var saved = history.findAllByTeacherIdOrderByStartsAtAsc(teacher.getId());
            assertThat(saved).hasSize(4).extracting(LessonHistoryEntry::getEventId).doesNotHaveDuplicates();
        } finally {
            executor.shutdownNow();
        }
    }
}
