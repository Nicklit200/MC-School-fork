package com.mcschool.flashcard.users;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.JwtService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** Real HTTP/JPA regression: no test transaction may keep lazy teacher proxies alive. */
class AdminAccountLoadingIntegrationTest extends AbstractIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private JwtService jwt;

    private String adminToken;
    private User teacher;
    private User student;

    @BeforeEach
    void seedAccounts() {
        User admin = users.save(User.bootstrapAdmin("Admin", "admin@test.local", "hash"));
        adminToken = jwt.generateToken(admin);
        teacher = users.save(User.activeTeacher("Old Teacher", "old@test.local", "oldteacher", "hash"));
        student = users.save(User.managedStudent("Active Student", teacher));
    }

    @Test
    void listsStudentsWithDetachedTeacherNamesAndExcludesArchivedAccounts() throws Exception {
        User archived = User.managedStudent("Archived Student", teacher);
        archived.archive();
        users.save(archived);

        mvc.perform(get("/api/v1/admin/accounts").param("role", "STUDENT")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(student.getId().toString()))
                .andExpect(jsonPath("$[0].teacherId").value(teacher.getId().toString()))
                .andExpect(jsonPath("$[0].teacherFullName").value("Old Teacher"));
    }

    @Test
    void listsParentsWithAndWithoutTeachers() throws Exception {
        users.save(User.activeParent("A Managed Parent", "managedparent", "hash", teacher));
        users.save(User.activeParent("B Unassigned Parent", "unassignedparent", "hash", null));

        mvc.perform(get("/api/v1/admin/accounts").param("role", "PARENT")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].teacherFullName").value("Old Teacher"))
                .andExpect(jsonPath("$[1].teacherId").isEmpty())
                .andExpect(jsonPath("$[1].teacherFullName").isEmpty());
    }

    @Test
    void singleStudentTransferPersistsAndReloadsTheNewTeacher() throws Exception {
        User newTeacher = users.save(User.activeTeacher("New Teacher", "new@test.local", "newteacher", "hash"));
        mvc.perform(put("/api/v1/admin/accounts/{id}/teacher", student.getId())
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"teacherId\":\"" + newTeacher.getId() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.student.teacherId").value(newTeacher.getId().toString()));

        mvc.perform(get("/api/v1/admin/accounts").param("role", "STUDENT")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].teacherFullName").value("New Teacher"));
    }

    @Test
    void rejectsNonAdminAccountListing() throws Exception {
        mvc.perform(get("/api/v1/admin/accounts").param("role", "STUDENT")
                        .header("Authorization", "Bearer " + jwt.generateToken(teacher)))
                .andExpect(status().isForbidden());
    }

    @Test
    void rejectsUnsupportedAccountRoles() throws Exception {
        mvc.perform(get("/api/v1/admin/accounts").param("role", "TEACHER")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isBadRequest());
    }
}
