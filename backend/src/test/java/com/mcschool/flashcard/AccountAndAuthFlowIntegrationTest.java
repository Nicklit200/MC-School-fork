package com.mcschool.flashcard;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

/**
 * End-to-end coverage of the PRD account lifecycle against a real PostgreSQL:
 * admin logs in, invites a teacher; the teacher activates the invitation and
 * invites a student; the student activates and is properly restricted.
 */
class AccountAndAuthFlowIntegrationTest extends AbstractIntegrationTest {

    private static final String ADMIN_EMAIL = "admin@test.local";
    private static final String ADMIN_PASSWORD = "AdminSecret123!";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @BeforeEach
    void seedAdmin() {
        userRepository.save(User.bootstrapAdmin("Admin", ADMIN_EMAIL,
                passwordEncoder.encode(ADMIN_PASSWORD)));
    }

    // --- Public endpoints and authentication basics ---

    @Test
    void healthEndpointIsPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }

    @Test
    void protectedEndpointsRequireAToken() throws Exception {
        mockMvc.perform(get("/api/v1/students"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("UNAUTHORIZED"));
    }

    @Test
    void loginReturnsTokenAndUser() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email": "%s", "password": "%s"}
                                """.formatted(ADMIN_EMAIL, ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andExpect(jsonPath("$.user.passwordHash").doesNotExist());
    }

    @Test
    void loginRejectsWrongPassword() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email": "%s", "password": "wrong-password"}
                                """.formatted(ADMIN_EMAIL)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("INVALID_CREDENTIALS"));
    }

    @Test
    void loginValidatesRequestBody() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email": "not-an-email", "password": ""}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors").isArray());
    }

    @Test
    void meReturnsTheAuthenticatedUser() throws Exception {
        String adminToken = loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(ADMIN_EMAIL))
                .andExpect(jsonPath("$.role").value("ADMIN"));
    }

    // --- Invitation lifecycle ---

    @Test
    void adminInvitesTeacherWhoInvitesStudentWhoActivates() throws Exception {
        String adminToken = loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

        // Admin creates a teacher account.
        String teacherInvitation = mockMvc.perform(post("/api/v1/teachers")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Maria Teacher", "email": "maria@test.local"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.teacher.role").value("TEACHER"))
                .andExpect(jsonPath("$.teacher.status").value("INVITED"))
                .andExpect(jsonPath("$.invitationToken").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        String teacherToken = activate(JsonPath.read(teacherInvitation, "$.invitationToken"),
                "TeacherPass123!", "maria@test.local");

        // Teacher creates a student account.
        String studentInvitation = mockMvc.perform(post("/api/v1/students")
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Sam Student", "email": "sam@test.local"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.student.role").value("STUDENT"))
                .andExpect(jsonPath("$.invitationToken").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        // The teacher sees exactly their own student.
        mockMvc.perform(get("/api/v1/students").header("Authorization", "Bearer " + teacherToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].email").value("sam@test.local"));

        // The student activates the invitation and is logged in.
        String studentToken = activate(JsonPath.read(studentInvitation, "$.invitationToken"),
                "StudentPass123!");
        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("STUDENT"))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    void invitationTokenCannotBeUsedTwice() throws Exception {
        String adminToken = loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
        String invitation = mockMvc.perform(post("/api/v1/teachers")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Maria Teacher", "email": "maria@test.local"}
                                """))
                .andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(invitation, "$.invitationToken");
        activate(token, "TeacherPass123!", "maria@test.local");

        mockMvc.perform(post("/api/v1/auth/activate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"invitationToken": "%s", "password": "AnotherPass123!"}
                                """.formatted(token)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_INVITATION"));
    }

    @Test
    void expiredInvitationIsRejected() throws Exception {
        userRepository.save(User.invitedTeacher("Late Teacher", "late@test.local",
                "expired-token-123", Instant.now().minusSeconds(60)));

        mockMvc.perform(post("/api/v1/auth/activate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"invitationToken": "expired-token-123", "password": "Password123!"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_INVITATION"));
    }

    @Test
    void duplicateEmailIsRejectedWithConflict() throws Exception {
        String adminToken = loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

        mockMvc.perform(post("/api/v1/teachers")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Duplicate Admin", "email": "%s"}
                                """.formatted(ADMIN_EMAIL)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("CONFLICT"));
    }

    // --- Authorization rules ---

    @Test
    void teacherCannotCreateTeachers() throws Exception {
        String teacherToken = createActivatedTeacher("maria@test.local");

        mockMvc.perform(post("/api/v1/teachers")
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Rogue Teacher", "email": "rogue@test.local"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode").value("ACCESS_DENIED"));
    }

    @Test
    void studentCannotAccessStudentManagement() throws Exception {
        String teacherToken = createActivatedTeacher("maria@test.local");
        String studentInvitation = mockMvc.perform(post("/api/v1/students")
                        .header("Authorization", "Bearer " + teacherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Sam Student", "email": "sam@test.local"}
                                """))
                .andReturn().getResponse().getContentAsString();
        String studentToken = activate(JsonPath.read(studentInvitation, "$.invitationToken"),
                "StudentPass123!");

        mockMvc.perform(get("/api/v1/students").header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void teachersOnlySeeTheirOwnStudents() throws Exception {
        String teacherOneToken = createActivatedTeacher("one@test.local");
        String teacherTwoToken = createActivatedTeacher("two@test.local");
        mockMvc.perform(post("/api/v1/students")
                        .header("Authorization", "Bearer " + teacherOneToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Sam Student", "email": "sam@test.local"}
                                """))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/v1/students").header("Authorization", "Bearer " + teacherTwoToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // --- Helpers ---

    private String loginAs(String email, String password) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email": "%s", "password": "%s"}
                                """.formatted(email, password)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.accessToken");
    }

    private String activate(String invitationToken, String password) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/activate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"invitationToken": "%s", "password": "%s"}
                                """.formatted(invitationToken, password)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.accessToken");
    }

    /** Non-student accounts must confirm their e-mail to activate. */
    private String activate(String invitationToken, String password, String email) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/activate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"invitationToken": "%s", "email": "%s", "password": "%s"}
                                """.formatted(invitationToken, email, password)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.accessToken");
    }

    private String createActivatedTeacher(String email) throws Exception {
        String adminToken = loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
        String invitation = mockMvc.perform(post("/api/v1/teachers")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fullName": "Teacher", "email": "%s"}
                                """.formatted(email)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return activate(JsonPath.read(invitation, "$.invitationToken"), "TeacherPass123!", email);
    }
}
