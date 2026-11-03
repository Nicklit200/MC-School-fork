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
@Import({PersonalLessonAnswersController.class, SecurityConfig.class, OnlineClassPilotAuthorizationManager.class,
        JwtAuthenticationFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = "app.cors.allowed-origins=https://school.invalid")
class PersonalLessonAnswersApiTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private PersonalLessonAnswersService service;
    @MockitoBean private UserRepository users;
    @MockitoBean private JwtService jwt;
    private static final UUID STUDENT = UUID.randomUUID();
    private static final String URL = "/api/v1/lesson-preparations/event/personal-answers/" + STUDENT;

    private UsernamePasswordAuthenticationToken account(Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(new AuthenticatedUser(STUDENT, null, role), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
    }

    @Test
    void teacherCanUploadInspectMetadataAndReadPdfWithoutSharedCaching() throws Exception {
        byte[] bytes = "%PDF-test".getBytes();
        var metadata = new PersonalLessonAnswersService.Metadata(STUDENT, true, "solutions.pdf", 1L);
        when(service.upload(any(), eq("event"), eq(STUDENT), eq("solutions.pdf"), eq(bytes))).thenReturn(metadata);
        when(service.metadata(any(), eq("event"), eq(STUDENT))).thenReturn(metadata);
        when(service.answers(any(), eq("event"), eq(STUDENT))).thenReturn(Optional.of(bytes));
        mvc.perform(multipart(URL).file(new MockMultipartFile("file", "solutions.pdf", "application/pdf", bytes))
                        .with(authentication(account(Role.TEACHER))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasAnswers").value(true))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get(URL + "/metadata").with(authentication(account(Role.TEACHER))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.answersFilename").value("solutions.pdf"))
                .andExpect(jsonPath("$.version").value(1)).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get(URL).with(authentication(account(Role.TEACHER))))
                .andExpect(status().isOk()).andExpect(content().bytes(bytes))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void evenTheAnswerOwnersStudentAccountCannotReadMetadataOrDownloadOrUpload() throws Exception {
        for (Role role : List.of(Role.STUDENT, Role.PARENT, Role.ADMIN)) {
            mvc.perform(get(URL).with(authentication(account(role)))).andExpect(status().isForbidden());
            mvc.perform(get(URL + "/metadata").with(authentication(account(role)))).andExpect(status().isForbidden());
            mvc.perform(multipart(URL).file(new MockMultipartFile("file", "solutions.pdf", "application/pdf", "%PDF-test".getBytes()))
                            .with(authentication(account(role))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get(URL)).andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }

    @Test
    void missingAnswersReturn404InsteadOfAnySharedFallback() throws Exception {
        when(service.answers(any(), any(), any())).thenReturn(Optional.empty());
        mvc.perform(get(URL).with(authentication(account(Role.TEACHER))))
                .andExpect(status().isNotFound()).andExpect(header().string("Cache-Control", "no-store"));
    }
}
