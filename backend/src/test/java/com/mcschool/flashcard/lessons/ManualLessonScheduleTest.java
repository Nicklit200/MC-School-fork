package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ManualLessonScheduleTest {
    @Configuration @EnableMethodSecurity static class Security {}
    private AnnotationConfigApplicationContext context;
    private GoogleCalendarLessonService lessons;
    private GroupLessonController controller;
    private MockMvc mvc;
    private final UUID teacherId = UUID.randomUUID();

    @BeforeEach
    void setup() {
        context = new AnnotationConfigApplicationContext();
        lessons = mock(GoogleCalendarLessonService.class);
        context.register(Security.class, GroupLessonController.class);
        // Ready-made mocks need no persistence-field injection from Spring.
        context.getBeanFactory().registerSingleton("calendar", lessons);
        context.getBeanFactory().registerSingleton("preparations", mock(LessonPreparationService.class));
        context.getBeanFactory().registerSingleton("nativeLessons", mock(ManualLessonService.class));
        context.getBeanFactory().registerSingleton("executionSummary", mock(LessonExecutionSummaryService.class));
        context.refresh();
        controller = context.getBean(GroupLessonController.class);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).build();
    }

    @AfterEach void cleanup() { SecurityContextHolder.clearContext(); context.close(); }

    private AuthenticatedUser authenticate(Role role) {
        var caller = new AuthenticatedUser(teacherId, null, role);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                caller, "unused", List.of(new SimpleGrantedAuthority("ROLE_" + role.name()))));
        return caller;
    }

    @Test
    void snapshotRequestUsesOnlySavedLessonsForTheAuthenticatedTeacher() throws Exception {
        var caller = authenticate(Role.TEACHER);
        mvc.perform(get("/api/v1/lessons/groups").param("refresh", "false")).andExpect(status().isOk());
        verify(lessons).listSavedGroupLessons(caller);
        verify(lessons, never()).listGroupLessons(any());
    }

    @Test
    void existingClientsStillRefreshCalendarByDefault() throws Exception {
        var caller = authenticate(Role.TEACHER);
        mvc.perform(get("/api/v1/lessons/groups")).andExpect(status().isOk());
        verify(lessons).listGroupLessons(caller);
        verify(lessons, never()).listSavedGroupLessons(any());
    }

    @Test
    void savedScheduleDoesNotBypassTeacherAuthorization() {
        for (var role : List.of(Role.STUDENT, Role.ADMIN)) {
            var caller = authenticate(role);
            assertThatThrownBy(() -> controller.listGroupLessons(caller, false)).isInstanceOf(AccessDeniedException.class);
        }
        verifyNoInteractions(lessons);
    }
}
