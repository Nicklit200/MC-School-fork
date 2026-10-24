package com.mcschool.flashcard.lessons;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.JwtAuthenticationFilter;
import com.mcschool.flashcard.auth.JwtService;
import com.mcschool.flashcard.auth.OnlineClassPilotAuthorizationManager;
import com.mcschool.flashcard.common.GlobalExceptionHandler;
import com.mcschool.flashcard.config.SecurityConfig;
import com.mcschool.flashcard.lessons.dto.CreateLessonRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The native schedule uses school accounts and remains independent of Google OAuth. */
@WebMvcTest(useDefaultFilters = false)
@Import({GroupLessonController.class, SecurityConfig.class, OnlineClassPilotAuthorizationManager.class,
        JwtAuthenticationFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = "app.cors.allowed-origins=https://school.invalid")
class ManualLessonApiTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private ManualLessonService nativeLessons;
    @MockitoBean private GoogleCalendarLessonService calendar;
    @MockitoBean private LessonPreparationService preparation;
    @MockitoBean private UserRepository users;
    @MockitoBean private JwtService jwt;

    private UsernamePasswordAuthenticationToken account(Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedUser(UUID.randomUUID(), null, role), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
    }

    private String trial() {
        return """
                {"title":"Пробный урок · Ученик","startsAt":"2026-11-05T23:00:00Z",
                 "endsAt":"2026-11-05T23:45:00Z","groupId":null,"studentId":null}
                """;
    }

    @Test
    void teacherCreatesUnassignedTrialWithoutGoogle() throws Exception {
        mvc.perform(post("/api/v1/lessons").with(authentication(account(Role.TEACHER)))
                        .contentType(MediaType.APPLICATION_JSON).content(trial()))
                .andExpect(status().isCreated());
        verify(nativeLessons).create(any(AuthenticatedUser.class), any(CreateLessonRequest.class));
        verify(calendar, never()).listGroupLessons(any());
    }

    @Test
    void studentsAndAdministratorsCannotCreateTeacherLessons() throws Exception {
        for (Role role : List.of(Role.STUDENT, Role.ADMIN, Role.PARENT)) {
            mvc.perform(post("/api/v1/lessons").with(authentication(account(role)))
                            .contentType(MediaType.APPLICATION_JSON).content(trial()))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(post("/api/v1/lessons").contentType(MediaType.APPLICATION_JSON).content(trial()))
                .andExpect(status().isUnauthorized());
        verify(nativeLessons, never()).create(any(), any());
    }

    @Test
    void invalidDatesAndTargetsFailBeforeAnyScheduleMutation() throws Exception {
        String invalid = """
                {"title":"Lesson","startsAt":"2026-11-05T23:00:00Z","endsAt":"2026-11-05T22:00:00Z",
                 "groupId":"c496144f-501b-46ea-8e6d-711d16fa0434","studentId":"6eb0b0b7-5e0d-4f2f-be40-57c7855401c7"}
                """;
        mvc.perform(post("/api/v1/lessons").with(authentication(account(Role.TEACHER)))
                        .contentType(MediaType.APPLICATION_JSON).content(invalid))
                .andExpect(status().isBadRequest());
        verify(nativeLessons, never()).create(any(), any());
    }

    @Test
    void finiteSeriesValidatesWeekdaysAndPeriodOnTheHttpBoundary() throws Exception {
        var teacher = account(Role.TEACHER);
        String valid = """
                {"title":"Weekly math","startDate":"2026-11-05","durationMinutes":45,
                 "period":"THREE_WEEKS","weekdays":[1,4],"groupId":null,"studentId":null}
                """;
        when(nativeLessons.createSeries(any(), any())).thenReturn(List.of());
        mvc.perform(post("/api/v1/lessons/series").with(authentication(teacher))
                        .contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/v1/lessons/series").with(authentication(teacher))
                        .contentType(MediaType.APPLICATION_JSON).content(valid.replace("[1,4]", "[0,8]")))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/lessons/series").with(authentication(teacher))
                        .contentType(MediaType.APPLICATION_JSON).content(valid.replace("THREE_WEEKS", "FOREVER")))
                .andExpect(status().isBadRequest());
    }
}
