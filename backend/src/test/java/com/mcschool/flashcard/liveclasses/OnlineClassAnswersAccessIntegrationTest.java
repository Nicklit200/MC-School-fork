package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.JwtService;
import com.mcschool.flashcard.auth.OnlineClassPilotAuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The answers file is for the teacher alone — over HTTP, with real tokens, not
 * just in the service layer. A student must not receive the file, nor any hint
 * of it, from any route they can reach.
 */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class OnlineClassAnswersAccessIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);
    private static final String EVENT = "event-answers";

    @Autowired
    private MockMvc mockMvc;
    // The production owner-only pilot is tested separately. Here we isolate the
    // per-class permissions for the bound student from the pilot owner's UUID.
    @MockitoBean
    private OnlineClassPilotAuthorizationManager pilotAuthorization;

    @BeforeEach
    void allowPilotOnlyForTheseMembershipTests() {
        when(pilotAuthorization.authorize(any(), any()))
                .thenReturn(new AuthorizationDecision(true));
    }


    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private LessonPreparationRepository preparations;

    private String teacherToken;
    private String studentToken;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        User teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local", "t1", END));
        User student = userRepository.save(User.invitedStudent("Student", "student@test.local",
                teacher, "s1", END));
        // Invited accounts are rejected by the JWT filter until activated.
        teacher.activate("hash");
        student.activate("hash");
        userRepository.save(teacher);
        userRepository.save(student);
        teacherToken = jwtService.generateToken(teacher);
        studentToken = jwtService.generateToken(student);

        OnlineClass created = OnlineClass.forStudent(teacher, EVENT, "binding-answers",
                "Maths", START, END, student);
        created.start(START);
        onlineClass = classRepository.save(created);
        ClassTestSupport.admit(participantRepository, onlineClass, student);

        LessonPreparation prep = LessonPreparation.create(teacher, EVENT);
        prep.attachWorkbook("workbook.pdf", "WORKBOOK-PDF".getBytes());
        prep.attachAnswers("answers.pdf", "ANSWERS-PDF".getBytes());
        preparations.save(prep);
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    @Test
    void theTeacherReadsTheAnswersFile() throws Exception {
        String body = mockMvc.perform(get("/api/v1/lesson-preparations/" + EVENT + "/answers")
                        .header("Authorization", bearer(teacherToken)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).isEqualTo("ANSWERS-PDF");
    }

    @Test
    void aStudentIsRefusedTheAnswersFileAndLearnsNothingAboutIt() throws Exception {
        String body = mockMvc.perform(get("/api/v1/lesson-preparations/" + EVENT + "/answers")
                        .header("Authorization", bearer(studentToken)))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("ANSWERS-PDF");
    }

    @Test
    void aStudentCannotReadTheLessonPreparationMetadataEither() throws Exception {
        // The metadata names the answers file and says whether one exists.
        mockMvc.perform(get("/api/v1/lesson-preparations/" + EVENT)
                        .header("Authorization", bearer(studentToken)))
                .andExpect(status().isForbidden());
    }

    @Test
    void anAnonymousCallerIsRefused() throws Exception {
        mockMvc.perform(get("/api/v1/lesson-preparations/" + EVENT + "/answers"))
                .andExpect(status().is4xxClientError());
    }

    @Test
    void theClassDocumentRouteGivesAStudentTheWorkbookNeverTheAnswers() throws Exception {
        String body = mockMvc.perform(get("/api/v1/online-classes/" + onlineClass.getId() + "/document")
                        .header("Authorization", bearer(studentToken)))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .content().contentTypeCompatibleWith(MediaType.APPLICATION_PDF))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).isEqualTo("WORKBOOK-PDF");
        assertThat(body).doesNotContain("ANSWERS");
    }
}
