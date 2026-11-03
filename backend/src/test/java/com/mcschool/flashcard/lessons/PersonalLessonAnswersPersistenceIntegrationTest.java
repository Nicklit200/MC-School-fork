package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.*;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.*;
import com.mcschool.flashcard.users.*;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Complete Flyway schema plus real HTTP authorization: answer PDFs never become pupil resources. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.online-classes.enabled=true")
@Testcontainers(disabledWithoutDocker = true)
class PersonalLessonAnswersPersistenceIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private PersonalLessonAnswersService answers;
    @Autowired private PersonalLessonAnswersRepository answerFiles;
    @Autowired private PersonalLessonWorkbookService workbooks;
    @Autowired private PersonalLessonWorkbookRepository workbookFiles;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private UserRepository users;
    @Autowired private StudentGroupRepository groups;
    @Autowired private StudentGroupMemberRepository members;
    @Autowired private OnlineClassRepository classes;
    @Autowired private OnlineClassParticipantRepository participants;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @MockitoBean private GoogleCalendarLessonService lessons;
    private User teacher;
    private User student;
    private User secondStudent;
    private StudentGroup group;
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
        teacher = User.activeTeacher("Nick", "answers@teacher.test", "answers-teacher", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        teacher = users.saveAndFlush(teacher);
        student = users.saveAndFlush(User.managedStudent("Mark", teacher));
        secondStudent = users.saveAndFlush(User.managedStudent("Alice", teacher));
        group = groups.saveAndFlush(StudentGroup.create(teacher, "Group"));
        members.saveAndFlush(StudentGroupMember.create(group, student));
        members.saveAndFlush(StudentGroupMember.create(group, secondStudent));
        caller = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "event", "event", group.getId(), "Group", null, null, List.of(student.getId(), secondStudent.getId()),
                "Math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
    }

    private UsernamePasswordAuthenticationToken account(UUID userId, Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(new AuthenticatedUser(userId, null, role), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
    }

    private String source(UUID studentId) {
        return "/api/v1/lesson-preparations/event/personal-answers/" + studentId;
    }

    private byte[] pdf(int pages) throws Exception {
        try (var document = new PDDocument(); var output = new ByteArrayOutputStream()) {
            for (int page = 0; page < pages; page++) document.addPage(new PDPage());
            document.save(output);
            return output.toByteArray();
        }
    }

    @Test
    void teacherCanUploadAnswersBeforeAWorksheetAndPupilCannotReadAnyAnswerRouteOrMetadata() throws Exception {
        byte[] privateAnswers = pdf(3);
        mvc.perform(multipart(source(student.getId()))
                        .file(new MockMultipartFile("file", "private-solutions.pdf", "application/pdf", privateAnswers))
                        .with(authentication(account(teacher.getId(), Role.TEACHER))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasAnswers").value(true))
                .andExpect(jsonPath("$.version").value(1)).andExpect(header().string("Cache-Control", "no-store"));
        assertThat(workbookFiles.count()).isZero();
        assertThat(answerFiles.count()).isEqualTo(1);
        var row = workbooks.list(caller, "event").students().stream().filter(item -> item.studentId().equals(student.getId())).findFirst().orElseThrow();
        assertThat(row.hasWorkbook()).isFalse();
        assertThat(row.hasAnswers()).isTrue();
        assertThat(row.answersFilename()).isEqualTo("private-solutions.pdf");
        assertThat(row.answersVersion()).isEqualTo(1L);

        for (Role role : List.of(Role.STUDENT, Role.PARENT, Role.ADMIN)) {
            mvc.perform(get(source(student.getId())).with(authentication(account(student.getId(), role))))
                    .andExpect(status().isForbidden());
            mvc.perform(get(source(student.getId()) + "/metadata").with(authentication(account(student.getId(), role))))
                    .andExpect(status().isForbidden());
            mvc.perform(multipart(source(student.getId()))
                            .file(new MockMultipartFile("file", "forbidden.pdf", "application/pdf", privateAnswers))
                            .with(authentication(account(student.getId(), role))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/v1/lesson-preparations/event/personal-workbooks")
                        .with(authentication(account(student.getId(), Role.STUDENT))))
                .andExpect(status().isForbidden());
        mvc.perform(get(source(student.getId())).with(authentication(account(teacher.getId(), Role.TEACHER))))
                .andExpect(status().isOk()).andExpect(content().bytes(privateAnswers))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void classroomDocumentAndVersionStayWorksheetOnlyEvenWhenPersonalAnswersExist() throws Exception {
        byte[] privateAnswers = pdf(3);
        answers.upload(caller, "event", student.getId(), "private-solutions.pdf", privateAnswers);
        var room = classes.saveAndFlush(OnlineClass.forGroup(teacher, "event", "event", "Math", Instant.now(), Instant.now().plusSeconds(3600), group));
        var admitted = OnlineClassParticipant.student(room, student);
        admitted.admit();
        participants.saveAndFlush(admitted);
        String document = "/api/v1/online-classes/" + room.getId() + "/document";
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        mvc.perform(get(document).param("boardId", board).with(authentication(account(student.getId(), Role.STUDENT))))
                .andExpect(status().isNotFound());
        mvc.perform(get(document + "/version").param("boardId", board).with(authentication(account(student.getId(), Role.STUDENT))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.hasAnswers").doesNotExist()).andExpect(jsonPath("$.answersFilename").doesNotExist());

        byte[] worksheet = pdf(2);
        var uploaded = workbooks.upload(caller, "event", student.getId(), "worksheet.pdf", worksheet);
        assertThat(uploaded.hasAnswers()).isTrue();
        answers.upload(caller, "event", student.getId(), "replaced-solutions.pdf", pdf(4));
        mvc.perform(get(document).param("boardId", board).with(authentication(account(student.getId(), Role.STUDENT))))
                .andExpect(status().isOk()).andExpect(content().bytes(worksheet));
        mvc.perform(get(document + "/version").param("boardId", board).with(authentication(account(student.getId(), Role.STUDENT))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void replacingOnePupilsAnswersPreservesOtherPupilSharedAnswersAndWorksheetVersions() throws Exception {
        byte[] shared = pdf(1);
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachAnswers("shared-solutions.pdf", shared);
        preparations.saveAndFlush(preparation);
        byte[] worksheet = pdf(2);
        workbooks.upload(caller, "event", student.getId(), "worksheet.pdf", worksheet);
        byte[] first = pdf(3);
        byte[] second = pdf(4);
        answers.upload(caller, "event", student.getId(), "mark.pdf", first);
        answers.upload(caller, "event", secondStudent.getId(), "alice.pdf", second);
        var sharedVersion = preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getVersion();
        byte[] replacement = pdf(5);
        assertThat(answers.upload(caller, "event", student.getId(), "corrected.pdf", replacement).version()).isEqualTo(2L);
        assertThat(answers.upload(caller, "event", student.getId(), "corrected.pdf", replacement).version()).isEqualTo(2L);
        assertThat(answers.answers(caller, "event", student.getId())).contains(replacement);
        assertThat(answers.answers(caller, "event", secondStudent.getId())).contains(second);
        assertThat(answers.metadata(caller, "event", secondStudent.getId()).version()).isEqualTo(1L);
        var kept = preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow();
        assertThat(kept.getAnswersPdf()).isEqualTo(shared);
        assertThat(kept.getVersion()).isEqualTo(sharedVersion);
        assertThat(workbookFiles.workbookVersion(teacher.getId(), "event", student.getId())).contains(0L);
        assertThat(workbooks.workbook(caller, "event", student.getId())).contains(worksheet);
        var row = workbooks.upload(caller, "event", student.getId(), "worksheet.pdf", worksheet);
        assertThat(row.version()).isEqualTo(1L);
        assertThat(row.answersVersion()).isEqualTo(2L);
        assertThat(row.answersFilename()).isEqualTo("corrected.pdf");
    }

    @Test
    void missingPersonalAnswersDoNotFallBackToSharedAndOtherTeachersCannotReadOrWrite() throws Exception {
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachAnswers("shared-solutions.pdf", pdf(1));
        preparations.saveAndFlush(preparation);
        assertThat(answers.metadata(caller, "event", student.getId()))
                .isEqualTo(new PersonalLessonAnswersService.Metadata(student.getId(), false, null, 0L));
        assertThat(answers.answers(caller, "event", student.getId())).isEmpty();
        mvc.perform(get(source(student.getId())).with(authentication(account(teacher.getId(), Role.TEACHER))))
                .andExpect(status().isNotFound()).andExpect(header().string("Cache-Control", "no-store"));
        answers.upload(caller, "event", student.getId(), "private-solutions.pdf", pdf(2));
        var other = users.saveAndFlush(User.activeTeacher("Other", "other@answers.test", "other-answers", "unused"));
        mvc.perform(get(source(student.getId())).with(authentication(account(other.getId(), Role.TEACHER)))).andExpect(status().isNotFound());
        mvc.perform(get(source(student.getId()) + "/metadata").with(authentication(account(other.getId(), Role.TEACHER)))).andExpect(status().isNotFound());
        mvc.perform(multipart(source(student.getId()))
                        .file(new MockMultipartFile("file", "forbidden.pdf", "application/pdf", pdf(1)))
                        .with(authentication(account(other.getId(), Role.TEACHER))))
                .andExpect(status().isNotFound());
        jdbc.update("update users set archived=true where id=?", student.getId());
        mvc.perform(get(source(student.getId())).with(authentication(account(teacher.getId(), Role.TEACHER)))).andExpect(status().isNotFound());
        mvc.perform(get(source(student.getId()) + "/metadata").with(authentication(account(teacher.getId(), Role.TEACHER)))).andExpect(status().isNotFound());
    }

    @Test
    void migrationEnforcesUniqueIdentityAndOptimisticLockingOnAnswerKeys() throws Exception {
        answers.upload(caller, "event", student.getId(), "first.pdf", pdf(1));
        var first = answerFiles.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()).orElseThrow();
        var stale = answerFiles.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()).orElseThrow();
        first.attach("second.pdf", pdf(2));
        answerFiles.saveAndFlush(first);
        stale.attach("stale.pdf", pdf(3));
        assertThatThrownBy(() -> answerFiles.saveAndFlush(stale)).isInstanceOf(ObjectOptimisticLockingFailureException.class);
        var duplicate = PersonalLessonAnswers.create(teacher.getId(), "event", student.getId());
        duplicate.attach("duplicate.pdf", pdf(1));
        assertThatThrownBy(() -> answerFiles.saveAndFlush(duplicate)).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(answerFiles.metadata(teacher.getId(), "event")).hasSize(1);
        assertThat(answerFiles.metadataForStudent(teacher.getId(), "event", student.getId()).orElseThrow().getVersion()).isEqualTo(1L);
    }
}
