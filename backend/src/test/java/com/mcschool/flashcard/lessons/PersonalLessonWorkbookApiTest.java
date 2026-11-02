package com.mcschool.flashcard.lessons;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.mcschool.flashcard.auth.*;
import com.mcschool.flashcard.common.GlobalExceptionHandler;
import com.mcschool.flashcard.config.SecurityConfig;
import com.mcschool.flashcard.users.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(useDefaultFilters = false)
@Import({PersonalLessonWorkbookController.class, SecurityConfig.class, OnlineClassPilotAuthorizationManager.class,
        JwtAuthenticationFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = "app.cors.allowed-origins=https://school.invalid")
class PersonalLessonWorkbookApiTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private PersonalLessonWorkbookService service;
    @MockitoBean private UserRepository users;
    @MockitoBean private JwtService jwt;

    private UsernamePasswordAuthenticationToken account(Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedUser(UUID.randomUUID(), null, role), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
    }

    @Test
    void teacherListsAndUploadsExactStudentWhilePdfResponsesAreNotCached() throws Exception {
        var teacher = account(Role.TEACHER);
        UUID studentId = UUID.randomUUID();
        when(service.list(any(), eq("event"))).thenReturn(new PersonalLessonWorkbookService.PersonalWorkbooksResponse(true, List.of()));
        mvc.perform(get("/api/v1/lesson-preparations/event/personal-workbooks").with(authentication(teacher)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true))
                .andExpect(header().string("Cache-Control", "no-store"));
        byte[] bytes = "%PDF-test".getBytes();
        mvc.perform(multipart("/api/v1/lesson-preparations/event/personal-workbooks/{studentId}", studentId)
                        .file(new MockMultipartFile("file", "personal.pdf", "application/pdf", bytes))
                        .with(authentication(teacher)))
                .andExpect(status().isOk());
        verify(service).upload(any(), eq("event"), eq(studentId), eq("personal.pdf"), eq(bytes));
        when(service.workbook(any(), eq("event"), eq(studentId))).thenReturn(Optional.of(bytes));
        mvc.perform(get("/api/v1/lesson-preparations/event/personal-workbooks/{studentId}", studentId).with(authentication(teacher)))
                .andExpect(status().isOk()).andExpect(content().bytes(bytes))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void studentsParentsAndAdminsCannotUseTeacherUploadOrListEndpoints() throws Exception {
        for (Role role : List.of(Role.STUDENT, Role.ADMIN, Role.PARENT)) {
            mvc.perform(get("/api/v1/lesson-preparations/event/personal-workbooks").with(authentication(account(role))))
                    .andExpect(status().isForbidden());
            mvc.perform(multipart("/api/v1/lesson-preparations/event/personal-workbooks/{studentId}", UUID.randomUUID())
                            .file(new MockMultipartFile("file", "personal.pdf", "application/pdf", "%PDF-test".getBytes()))
                            .with(authentication(account(role))))
                    .andExpect(status().isForbidden());
        }
        verifyNoInteractions(service);
    }
}
