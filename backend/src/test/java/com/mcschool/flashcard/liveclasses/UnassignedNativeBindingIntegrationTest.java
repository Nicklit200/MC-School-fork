package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.GoogleCalendarOAuthService;
import com.mcschool.flashcard.lessons.LessonHistoryEntry;
import com.mcschool.flashcard.lessons.LessonHistoryRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Real native-history reads must bypass an already cached assignment after the room lock. */
@SpringBootTest
@TestPropertySource(properties = "app.online-classes.enabled=true")
@Testcontainers(disabledWithoutDocker = true)
class UnassignedNativeBindingIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private OnlineClassService service;
    @Autowired private OnlineClassRepository classes;
    @Autowired private LessonHistoryRepository history;
    @Autowired private UserRepository users;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactions;
    @PersistenceContext private EntityManager entityManager;
    @MockitoBean private GoogleCalendarOAuthService oauth;
    @MockitoSpyBean private OnlineClassAccessService access;
    private static final String EVENT = "local-fresh-native-binding";
    private User teacher, firstPupil, currentPupil;
    private AuthenticatedUser caller;
    private Instant start, end;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username", DATABASE::getUsername);
        properties.add("spring.datasource.password", DATABASE::getPassword);
        properties.add("app.online-classes.idle-sweep-initial-ms", () -> "86400000");
    }

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher = users.saveAndFlush(User.activeTeacher("Teacher", "teacher@fresh-native.test", "fresh-teacher", "unused"));
        firstPupil = users.saveAndFlush(User.managedStudent("First", teacher));
        currentPupil = users.saveAndFlush(User.managedStudent("Current", teacher));
        caller = new AuthenticatedUser(teacher.getId(), null, teacher.getRole());
        start = Instant.now().minusSeconds(300);
        end = start.plusSeconds(3600);
        when(oauth.accessTokenForTeacher(teacher.getId())).thenReturn(null);
        history.saveAndFlush(LessonHistoryEntry.create(teacher, lesson(null)));
    }

    private GroupLessonResponse lesson(User pupil) {
        return new GroupLessonResponse(EVENT, EVENT, null, null,
                pupil == null ? null : pupil.getId(), pupil == null ? null : pupil.getFullName(),
                pupil == null ? List.of() : List.of(pupil.getId()), "Native preview", start, end, null, null);
    }

    private UUID previewWithAnAssignedSchedule() {
        UUID classId = service.materializeFromCalendar(caller, EVENT).id();
        LessonHistoryEntry entry = history.findByTeacherIdAndEventId(teacher.getId(), EVENT).orElseThrow();
        entry.reassign(lesson(firstPupil));
        history.saveAndFlush(entry);
        return classId;
    }

    private void committedUpdate(Runnable update) {
        var separate = new TransactionTemplate(transactions);
        separate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        separate.executeWithoutResult(status -> update.run());
    }

    @Test
    void promotionUsesCommittedNativeAssignmentInsteadOfTheManagedHistoryCachedByTheFirstRead() {
        UUID classId = previewWithAnAssignedSchedule();
        AtomicBoolean lockReached = new AtomicBoolean();
        AtomicReference<LessonHistoryEntry> cachedBeforeLock = new AtomicReference<>();
        doAnswer(invocation -> {
            OnlineClass locked = (OnlineClass) invocation.callRealMethod();
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            assertThat(entityManager.contains(locked)).isTrue();
            LessonHistoryEntry cached = history.findByTeacherIdAndEventId(teacher.getId(), EVENT).orElseThrow();
            assertThat(entityManager.contains(cached)).isTrue();
            assertThat(cached.getStudentId()).isEqualTo(firstPupil.getId());
            cachedBeforeLock.set(cached);
            committedUpdate(() -> jdbc.update("""
                    UPDATE lesson_history SET student_id=?, student_name=?, participant_student_ids=?,
                        version=version+1, updated_at=now() WHERE teacher_id=? AND event_id=?
                    """, currentPupil.getId(), currentPupil.getFullName(), currentPupil.getId().toString(), teacher.getId(), EVENT));
            // This is the same persistence-context cache the second list used
            // before the fix. The separate committed JDBC write did not refresh it.
            assertThat(cached.getStudentId()).isEqualTo(firstPupil.getId());
            assertThat(entityManager.contains(locked)).isTrue();
            lockReached.set(true);
            return locked;
        }).when(access).requireHostForUpdate(caller, classId);

        assertThat(service.materializeFromCalendar(caller, EVENT).id()).isEqualTo(classId);
        assertThat(lockReached).isTrue();
        assertThat(cachedBeforeLock.get().getStudentId()).isEqualTo(currentPupil.getId());
        assertThat(classes.findById(classId).orElseThrow().getStudent().getId()).isEqualTo(currentPupil.getId());
        assertThat(classes.count()).isEqualTo(1);
    }

    @Test
    void aCommittedNativeTombstoneCannotBeHiddenByTheManagedHistoryCacheDuringPromotion() {
        UUID classId = previewWithAnAssignedSchedule();
        AtomicBoolean lockReached = new AtomicBoolean();
        doAnswer(invocation -> {
            OnlineClass locked = (OnlineClass) invocation.callRealMethod();
            LessonHistoryEntry cached = history.findByTeacherIdAndEventId(teacher.getId(), EVENT).orElseThrow();
            assertThat(entityManager.contains(cached)).isTrue();
            assertThat(cached.getDeletedAt()).isNull();
            committedUpdate(() -> jdbc.update("""
                    UPDATE lesson_history SET deleted_at=now(), version=version+1, updated_at=now()
                    WHERE teacher_id=? AND event_id=?
                    """, teacher.getId(), EVENT));
            assertThat(cached.getDeletedAt()).isNull();
            lockReached.set(true);
            return locked;
        }).when(access).requireHostForUpdate(caller, classId);

        assertThatThrownBy(() -> service.materializeFromCalendar(caller, EVENT)).isInstanceOf(ResourceNotFoundException.class);
        assertThat(lockReached).isTrue();
        assertThat(classes.findById(classId).orElseThrow().isTeacherOnly()).isTrue();
        assertThat(history.findByTeacherIdAndEventId(teacher.getId(), EVENT).orElseThrow().getDeletedAt()).isNotNull();
    }
}
