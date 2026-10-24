package com.mcschool.flashcard.notebookcamera;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.JwtAuthenticationFilter;
import com.mcschool.flashcard.auth.JwtService;
import com.mcschool.flashcard.auth.OnlineClassPilotAuthorizationManager;
import com.mcschool.flashcard.common.GlobalExceptionHandler;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.config.SecurityConfig;
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
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;

/** Real security filter + MVC validation, without a database or external media service. */
@WebMvcTest(useDefaultFilters = false)
@Import({NotebookCameraController.class, PublicNotebookCameraController.class,
        SecurityConfig.class, OnlineClassPilotAuthorizationManager.class,
        JwtAuthenticationFilter.class, NotebookCameraNoStoreFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.pilot-owner-id=14e3c7c1-1fc8-41bd-858a-6c20efdd957a",
        "app.cors.allowed-origins=https://school.invalid"
})
class NotebookCameraApiTest {
    private static final UUID ID = UUID.fromString("083265f9-75b6-4f27-8da2-3a67410309ec");
    private static final UUID TEACHER = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    private static final String SECRET = "a".repeat(43);
    @Autowired private MockMvc mvc;
    @MockitoBean private NotebookCameraService service;
    @MockitoBean private JwtService jwt;
    @MockitoBean private UserRepository users;

    @Test
    void phoneClaimNeedsNoAccountLoginAndErrorCannotBeCached() throws Exception {
        when(service.claim(ID, SECRET)).thenThrow(new ResourceNotFoundException("Expired link"));
        mvc.perform(post("/api/v1/public/notebook-cameras/{id}/claim", ID)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"" + SECRET + "\"}"))
                .andExpect(status().isNotFound()).andExpect(header().string("Cache-Control", "no-store"));
        verify(service).claim(ID, SECRET);
    }

    @Test
    void phoneReconnectNeedsOnlyTheScopedSecret() throws Exception {
        when(service.phoneConnection(ID, SECRET)).thenThrow(new ResourceNotFoundException("Expired session"));
        mvc.perform(post("/api/v1/public/notebook-cameras/{id}/connection", ID)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"sessionToken\":\"" + SECRET + "\"}"))
                .andExpect(status().isNotFound()).andExpect(header().string("Cache-Control", "no-store"));
        verify(service).phoneConnection(ID, SECRET);
    }

    @Test
    void malformedAndOversizedSecretsAreRejectedBeforeService() throws Exception {
        mvc.perform(post("/api/v1/public/notebook-cameras/{id}/claim", ID)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"short\"}"))
                .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(post("/api/v1/public/notebook-cameras/{id}/connection", ID)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"sessionToken\":\"" + "a".repeat(1000) + "\"}"))
                .andExpect(status().isBadRequest());
        verify(service, never()).claim(any(), anyString());
        verify(service, never()).phoneConnection(any(), anyString());
    }

    @Test
    void accountEndpointsStillRequireLogin() throws Exception {
        mvc.perform(get("/api/v1/notebook-cameras/lessons/event-1"))
                .andExpect(status().isUnauthorized()).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(post("/api/v1/notebook-cameras/{id}/connection", ID))
                .andExpect(status().isUnauthorized());
        verify(service, never()).list(any(), anyString());
    }

    @Test
    void exactPilotTeacherCanUseAuthenticatedApiButOtherTeacherCannot() throws Exception {
        var principal = new AuthenticatedUser(TEACHER, null, Role.TEACHER);
        var auth = UsernamePasswordAuthenticationToken.authenticated(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_TEACHER")));
        when(service.list(principal, "event-1")).thenReturn(List.of());
        mvc.perform(get("/api/v1/notebook-cameras/lessons/event-1").with(authentication(auth)))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        verify(service).list(eq(principal), eq("event-1"));
        var outsider = UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedUser(UUID.randomUUID(), null, Role.TEACHER), null,
                List.of(new SimpleGrantedAuthority("ROLE_TEACHER")));
        mvc.perform(get("/api/v1/notebook-cameras/lessons/event-1").with(authentication(outsider)))
                .andExpect(status().isForbidden());
    }

    @Test
    void unrelatedPublicRoutesAreNotOpenedByCameraException() throws Exception {
        mvc.perform(post("/api/v1/public/notebook-cameras/{id}/revoke", ID))
                .andExpect(status().isUnauthorized());
    }
}
