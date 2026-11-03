package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.PersonalBoard;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
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
import tools.jackson.databind.ObjectMapper;

/** Actual migrated storage and HTTP authorization for an archive's first preparation. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.online-classes.enabled=true")
@Testcontainers(disabledWithoutDocker = true)
class CompletedLessonArchivePreparationIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private UserRepository users;
    @Autowired private OnlineClassRepository classes;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @MockitoBean private GoogleCalendarLessonService calendar;
    private static final String EVENT = "blank-archive-event";
    private User teacher, student, foreignTeacher;
    private OnlineClass room;

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
        teacher = User.activeTeacher("Owner", "owner@archive.test", "archive-owner", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        teacher = users.saveAndFlush(teacher);
        foreignTeacher = users.saveAndFlush(User.activeTeacher("Other", "other@archive.test", "archive-other", "unused"));
        student = users.saveAndFlush(User.managedStudent("Pupil", teacher));
        room = OnlineClass.forStudent(teacher, EVENT, EVENT, "Blank lesson", Instant.now().minusSeconds(3600), Instant.now(), student);
        room.start(Instant.now().minusSeconds(3600));
        room.end(Instant.now());
        room = classes.saveAndFlush(room);
    }

    private UsernamePasswordAuthenticationToken account(User user) {
        return account(new AuthenticatedUser(user.getId(), null, user.getRole()));
    }

    private UsernamePasswordAuthenticationToken account(AuthenticatedUser principal) {
        return UsernamePasswordAuthenticationToken.authenticated(principal, "unused",
                List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name())));
    }

    private String path(String eventId) {
        return "/api/v1/lesson-preparations/" + eventId + "/completed-documents";
    }

    private byte[] pdf(int pages) throws Exception {
        try (var document = new PDDocument(); var output = new ByteArrayOutputStream()) {
            for (int page = 0; page < pages; page++) document.addPage(new PDPage());
            document.save(output);
            return output.toByteArray();
        }
    }

    private MockMultipartFile file(byte[] pdf) {
        return new MockMultipartFile("file", "finished.pdf", "application/pdf", pdf);
    }

    private UUID save(String boardId, byte[] pdf) throws Exception {
        String response = mvc.perform(multipart(path(EVENT)).file(file(pdf))
                        .param("classId", room.getId().toString()).param("boardId", boardId)
                        .with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.readTree(response).path("id").asText());
    }

    @Test
    void endedBlankClassCanCreateItsFirstPreparationSaveAndDownloadAndReplaceOneArchive() throws Exception {
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), EVENT)).isEmpty();
        byte[] first = pdf(1), replacement = pdf(2);
        UUID id = save("board-1", first);
        var preparation = preparations.findByTeacherIdAndEventId(teacher.getId(), EVENT).orElseThrow();
        assertThat(preparation.hasWorkbook()).isFalse();
        assertThat(preparation.hasAnswers()).isFalse();
        mvc.perform(get(path(EVENT)).with(authentication(account(teacher))))
                .andExpect(status().isOk());
        assertThat(mvc.perform(get(path(EVENT) + "/" + id).with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(first);

        assertThat(save("board-1", replacement)).isEqualTo(id);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM completed_lesson_documents", Integer.class)).isEqualTo(1);
        assertThat(mvc.perform(get(path(EVENT) + "/" + id).with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(replacement);
    }

    @Test
    void foreignTeacherMissingClassAndWrongEventCannotCreatePreparationOrArchive() throws Exception {
        for (String eventId : List.of(EVENT, "invented-event")) {
            mvc.perform(multipart(path(eventId)).file(file(pdf(1)))
                            .param("classId", room.getId().toString()).param("boardId", "board-1")
                            .with(authentication(account(foreignTeacher))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(multipart(path("invented-event")).file(file(pdf(1)))
                        .param("classId", room.getId().toString()).param("boardId", "board-1")
                        .with(authentication(account(teacher))))
                .andExpect(status().isForbidden());
        mvc.perform(multipart(path(EVENT)).file(file(pdf(1)))
                        .param("classId", UUID.randomUUID().toString()).param("boardId", "board-1")
                        .with(authentication(account(teacher))))
                .andExpect(status().isForbidden());
        assertNoPreparationOrArchive();
    }

    @Test
    void invalidFilesAndStudentOrParentRolesCannotCreatePreparation() throws Exception {
        for (byte[] bytes : List.of(new byte[0], "not a PDF".getBytes())) {
            mvc.perform(multipart(path(EVENT)).file(file(bytes))
                            .param("classId", room.getId().toString()).param("boardId", "board-1")
                            .with(authentication(account(teacher))))
                    .andExpect(status().isBadRequest());
        }
        for (Role role : List.of(Role.STUDENT, Role.PARENT)) {
            var principal = new AuthenticatedUser(student.getId(), null, role);
            mvc.perform(multipart(path(EVENT)).file(file(pdf(1)))
                            .param("classId", room.getId().toString()).param("boardId", "board-1")
                            .with(authentication(account(principal))))
                    .andExpect(status().isForbidden());
        }
        assertNoPreparationOrArchive();
    }

    @Test
    void privateArchiveKeepsPilotAndCurrentStudentGuardBeforePreparationCreation() throws Exception {
        String privateBoard = PersonalBoard.workbookTargetIdFor(student.getId());
        mvc.perform(multipart(path(EVENT)).file(file(pdf(1)))
                        .param("classId", room.getId().toString()).param("boardId", PersonalBoard.workbookTargetIdFor(UUID.randomUUID()))
                        .with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
        assertNoPreparationOrArchive();
        jdbc.update("UPDATE users SET archived=true WHERE id=?", student.getId());
        mvc.perform(multipart(path(EVENT)).file(file(pdf(1)))
                        .param("classId", room.getId().toString()).param("boardId", privateBoard)
                        .with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
        assertNoPreparationOrArchive();
        jdbc.update("UPDATE users SET archived=false WHERE id=?", student.getId());
        UUID id = save(privateBoard, pdf(2));
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), EVENT)).isPresent();
        assertThat(jdbc.queryForObject("SELECT board_id FROM completed_lesson_documents WHERE id=?", String.class, id))
                .isEqualTo(privateBoard);
    }

    private void assertNoPreparationOrArchive() {
        assertThat(preparations.count()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM completed_lesson_documents", Integer.class)).isZero();
    }
}
