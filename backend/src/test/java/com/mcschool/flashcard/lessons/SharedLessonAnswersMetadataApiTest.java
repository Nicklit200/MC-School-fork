package com.mcschool.flashcard.lessons;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.mcschool.flashcard.auth.*;
import com.mcschool.flashcard.common.GlobalExceptionHandler;
import com.mcschool.flashcard.config.SecurityConfig;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.*;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(useDefaultFilters = false)
@Import({LessonPreparationController.class, AdminLessonManagementController.class, SecurityConfig.class,
        OnlineClassPilotAuthorizationManager.class, JwtAuthenticationFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = "app.cors.allowed-origins=https://school.invalid")
class SharedLessonAnswersMetadataApiTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private LessonPreparationService preparations;
    @MockitoBean private GoogleCalendarLessonService lessons;
    @MockitoBean private McpHomeworkSeriesService homework;
    @MockitoBean private GoogleCalendarOAuthService calendarOAuth;
    @MockitoBean private TranscriptLessonGuard transcriptGuard;
    @MockitoBean private UserRepository users;
    @MockitoBean private JwtService jwt;
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.invalid", "teacher", "unused");
    private final String source = "/api/v1/lesson-preparations/event/answers";
    private final String adminSource = "/api/v1/admin/teachers/" + teacher.getId() + "/lesson-preparations/event/answers";

    private UsernamePasswordAuthenticationToken account(Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedUser(teacher.getId(), teacher.getEmail(), role), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
    }

    private void adminLesson() {
        when(users.findById(teacher.getId())).thenReturn(Optional.of(teacher));
        GroupLessonResponse lesson = mock(GroupLessonResponse.class);
        when(lesson.eventId()).thenReturn("event");
        when(lessons.listGroupLessons(any())).thenReturn(List.of(lesson));
    }

    @Test
    void teacherPollsOnlyAnswerMetadataWithoutSharedCaching() throws Exception {
        when(preparations.answersMetadata(any(), eq("event")))
                .thenReturn(new LessonPreparationService.AnswersMetadata(true, "answers.pdf", 4L));
        mvc.perform(get(source + "/metadata").with(authentication(account(Role.TEACHER))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.hasAnswers").value(true))
                .andExpect(jsonPath("$.answersFilename").value("answers.pdf"))
                .andExpect(jsonPath("$.version").value(4))
                .andExpect(jsonPath("$.workbookFilename").doesNotExist())
                .andExpect(jsonPath("$.transcriptText").doesNotExist())
                .andExpect(jsonPath("$.lessonPlan").doesNotExist());
        verify(preparations).answersMetadata(argThat(actor -> actor.id().equals(teacher.getId())), eq("event"));
        verifyNoMoreInteractions(preparations);
    }

    @Test
    void pupilsParentsAdministratorsAndAnonymousCannotReadTheTeacherMetadataRoute() throws Exception {
        for (Role role : List.of(Role.STUDENT, Role.PARENT, Role.ADMIN)) {
            mvc.perform(get(source + "/metadata").with(authentication(account(role))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get(source + "/metadata")).andExpect(status().isUnauthorized());
        verifyNoInteractions(preparations);
    }

    @Test
    void adminMetadataChecksTheSelectedTeachersLessonAndDoesNotWidenTeacherRoutes() throws Exception {
        adminLesson();
        when(preparations.answersMetadata(any(), eq("event")))
                .thenReturn(new LessonPreparationService.AnswersMetadata(false, null, 0L));
        mvc.perform(get(adminSource + "/metadata").with(authentication(account(Role.ADMIN))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.hasAnswers").value(false))
                .andExpect(jsonPath("$.version").value(0));
        verify(lessons).listGroupLessons(argThat(actor -> actor.id().equals(teacher.getId())));
        verify(preparations).answersMetadata(argThat(actor -> actor.id().equals(teacher.getId())), eq("event"));
        clearInvocations(preparations);
        for (Role role : List.of(Role.STUDENT, Role.PARENT, Role.TEACHER)) {
            mvc.perform(get(adminSource + "/metadata").with(authentication(account(role))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get(adminSource + "/metadata")).andExpect(status().isUnauthorized());
        verifyNoInteractions(preparations);
    }

    @Test
    void sharedAnswerPdfAndMissingPdfAreNeverCachedForTeacherOrAdmin() throws Exception {
        adminLesson();
        byte[] bytes = "%PDF-test".getBytes();
        LessonPreparation preparation = LessonPreparation.create(teacher, "event");
        preparation.attachAnswers("answers.pdf", bytes);
        when(preparations.require(any(), eq("event"))).thenReturn(preparation);
        for (var target : List.of(source, adminSource)) {
            Role role = target.equals(source) ? Role.TEACHER : Role.ADMIN;
            mvc.perform(get(target).with(authentication(account(role))))
                    .andExpect(status().isOk()).andExpect(content().bytes(bytes))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        when(preparations.require(any(), eq("event"))).thenReturn(LessonPreparation.create(teacher, "event"));
        for (var target : List.of(source, adminSource)) {
            Role role = target.equals(source) ? Role.TEACHER : Role.ADMIN;
            mvc.perform(get(target).with(authentication(account(role))))
                    .andExpect(status().isNotFound()).andExpect(header().string("Cache-Control", "no-store"));
        }
    }
}
