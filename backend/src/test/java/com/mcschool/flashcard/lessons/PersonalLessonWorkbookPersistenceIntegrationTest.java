package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.*;
import com.mcschool.flashcard.users.*;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Complete Flyway history, actual bytea persistence and optimistic locking in PostgreSQL. */
@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class PersonalLessonWorkbookPersistenceIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private PersonalLessonWorkbookService service;
    @Autowired private PersonalLessonWorkbookRepository workbooks;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private UserRepository users;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private OnlineClassRepository classes;
    @Autowired private OnlineClassParticipantRepository participants;
    @Autowired private OnlineClassDocumentService documents;
    @Autowired private StudentGroupRepository groups;
    @Autowired private StudentGroupMemberRepository groupMembers;
    @Autowired private CompletedLessonDocumentController completedDocuments;
    @Autowired private PlatformTransactionManager transactions;
    @MockitoBean private GoogleCalendarLessonService lessons;
    private User teacher;
    private User student;
    private AuthenticatedUser caller;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username", DATABASE::getUsername);
        properties.add("spring.datasource.password", DATABASE::getPassword);
    }

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher = User.activeTeacher("Nick", "nick@personal.test", "nick-personal", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        teacher = users.saveAndFlush(teacher);
        student = users.saveAndFlush(User.managedStudent("Student", teacher));
        caller = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "event", "event", null, null, student.getId(), "Student", List.of(student.getId()),
                "Math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
    }

    private byte[] pdf(int pages) throws Exception {
        try (var document = new PDDocument(); var out = new ByteArrayOutputStream()) {
            for (int index = 0; index < pages; index++) document.addPage(new PDPage());
            document.save(out);
            return out.toByteArray();
        }
    }

    @Test
    void migrationPersistsPersonalBytesAndMetadataWithoutChangingSharedWorkbook() throws Exception {
        byte[] shared = pdf(1);
        byte[] personal = pdf(2);
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachWorkbook("shared.pdf", shared);
        preparations.saveAndFlush(preparation);
        long preparationVersion = preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getVersion();

        var uploaded = service.upload(caller, "event", student.getId(), "personal.pdf", personal);
        assertThat(uploaded.version()).isEqualTo(1L);
        assertThat(service.workbook(caller, "event", student.getId())).contains(personal);
        assertThat(service.list(caller, "event").students()).containsExactly(uploaded);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getWorkbookPdf()).isEqualTo(shared);
        assertThat(jdbc.queryForObject("select to_regclass('public.personal_lesson_workbooks')::text", String.class))
                .isEqualTo("personal_lesson_workbooks");

        assertThat(service.upload(caller, "event", student.getId(), "personal.pdf", personal).version()).isEqualTo(1L);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getVersion())
                .isEqualTo(preparationVersion);
        assertThat(service.upload(caller, "event", student.getId(), "updated.pdf", pdf(3)).version()).isEqualTo(2L);
        assertThat(workbooks.count()).isEqualTo(1);
    }

    @Test
    void uniqueIdentityAndStaleEntityPreventConcurrentOverwrite() throws Exception {
        service.upload(caller, "event", student.getId(), "first.pdf", pdf(1));
        var first = workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()).orElseThrow();
        var stale = workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()).orElseThrow();
        first.attach("new.pdf", pdf(2));
        workbooks.saveAndFlush(first);
        stale.attach("stale.pdf", pdf(3));
        assertThatThrownBy(() -> workbooks.saveAndFlush(stale)).isInstanceOf(ObjectOptimisticLockingFailureException.class);
        var duplicate = PersonalLessonWorkbook.create(teacher.getId(), "event", student.getId());
        duplicate.attach("duplicate.pdf", pdf(1));
        assertThatThrownBy(() -> workbooks.saveAndFlush(duplicate)).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(workbooks.metadata(teacher.getId(), "event")).hasSize(1);
        assertThat(workbooks.workbookVersion(teacher.getId(), "event", student.getId())).contains(1L);
    }

    @Test
    void actualAdmissionAndCurrentOwnershipProtectPersonalDocumentAndVersion() throws Exception {
        byte[] personal = pdf(2);
        service.upload(caller, "event", student.getId(), "personal.pdf", personal);
        var room = classes.saveAndFlush(OnlineClass.forStudent(teacher, "event", "event", "Math",
                Instant.now(), Instant.now().plusSeconds(3600), student));
        var studentCaller = new AuthenticatedUser(student.getId(), null, Role.STUDENT);
        String board = "personal-workbook-" + student.getId();
        assertThatThrownBy(() -> documents.workbook(studentCaller, room.getId(), board))
                .isInstanceOf(ResourceNotFoundException.class);
        var participant = OnlineClassParticipant.student(room, student);
        participant.admit();
        participants.saveAndFlush(participant);
        assertThat(documents.workbook(studentCaller, room.getId(), board)).contains(personal);
        assertThat(documents.workbookVersion(studentCaller, room.getId(), board)).isEqualTo(1L);
        assertThat(documents.workbook(caller, room.getId(), board)).contains(personal);

        User other = users.saveAndFlush(User.managedStudent("Other", teacher));
        var otherCaller = new AuthenticatedUser(other.getId(), null, Role.STUDENT);
        assertThatThrownBy(() -> documents.workbook(otherCaller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> documents.workbookVersion(otherCaller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);

        jdbc.update("update users set archived=true where id=?", student.getId());
        assertThatThrownBy(() -> documents.workbook(caller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> documents.workbookVersion(caller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @WithMockUser(roles = "TEACHER")
    void detachedGroupClassCanValidateMembershipAndSaveCompletedWorksheetWithoutOpenSession() throws Exception {
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Group"));
        groupMembers.saveAndFlush(StudentGroupMember.create(group, student));
        var room = classes.saveAndFlush(OnlineClass.forGroup(teacher, "group-event", "group-event", "Group math",
                Instant.now(), Instant.now().plusSeconds(3600), group));
        // Repository transactions have ended: group membership and student entities
        // must be loaded inside the guard's own transaction (open-in-view is false).
        var detachedRoom = classes.findById(room.getId()).orElseThrow();
        assertThatCode(() -> service.requireClassStudent(detachedRoom, student.getId())).doesNotThrowAnyException();

        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "group-event", "group-event", group.getId(), "Group", null, null, List.of(student.getId()),
                "Group math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "group-event")).isEmpty();
        service.upload(caller, "group-event", student.getId(), "personal-only.pdf", pdf(1));
        var emptyPreparation = preparations.findByTeacherIdAndEventId(teacher.getId(), "group-event").orElseThrow();
        assertThat(emptyPreparation.hasWorkbook()).isFalse();
        assertThat(emptyPreparation.hasAnswers()).isFalse();
        byte[] finished = pdf(2);
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        var saved = completedDocuments.save(caller, "group-event", room.getId(), board,
                new MockMultipartFile("file", "completed.pdf", "application/pdf", finished));
        assertThat(saved.boardId()).isEqualTo(board);
        assertThat(saved.classId()).isEqualTo(room.getId());
        assertThat(completedDocuments.download(caller, "group-event", saved.id()).getBody()).isEqualTo(finished);
    }

    @Test
    void freshScalarTargetGuardRejectsArchivedAndTransferredStudentDespiteCachedIdentity() throws Exception {
        User otherTeacher = users.saveAndFlush(User.activeTeacher("Other", "other@personal.test", "other-personal", "unused"));
        byte[] bytes = pdf(1);
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            User cached = users.findById(student.getId()).orElseThrow();
            assertThat(cached.isArchived()).isFalse();
            assertThat(cached.getTeacher().getId()).isEqualTo(teacher.getId());
            jdbc.update("update users set archived=true where id=?", student.getId());
            assertThat(cached.isArchived()).isFalse();
            assertThat(service.list(caller, "event").students()).isEmpty();

            jdbc.update("update users set archived=false, teacher_id=? where id=?", otherTeacher.getId(), student.getId());
            assertThat(cached.getTeacher().getId()).isEqualTo(teacher.getId());
            assertThat(service.list(caller, "event").students()).isEmpty();
            assertThatThrownBy(() -> service.upload(caller, "event", student.getId(), "forbidden.pdf", bytes))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThat(workbooks.count()).isZero();
            status.setRollbackOnly();
        });
    }
}
