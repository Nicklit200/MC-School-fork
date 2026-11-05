package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

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
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

/** Exercises the real method-security interceptor, independently of provider credentials or a DB. */
class OnlineClassAudioFocusAuthorizationTest {
    @Configuration
    @EnableMethodSecurity
    static class Security {}

    private AnnotationConfigApplicationContext context;
    private OnlineClassAudioFocusController controller;
    private OnlineClassAudioFocusService service;
    private final UUID classId = UUID.randomUUID(), teacherId = UUID.randomUUID();
    private final OnlineClassAudioFocusService.Request request = new OnlineClassAudioFocusService.Request(null, false);

    @BeforeEach
    void setup() {
        context = new AnnotationConfigApplicationContext();
        service = mock(OnlineClassAudioFocusService.class);
        context.register(Security.class, OnlineClassAudioFocusController.class);
        context.registerBean(OnlineClassAudioFocusService.class, () -> service);
        context.refresh();
        controller = context.getBean(OnlineClassAudioFocusController.class);
    }

    @AfterEach
    void cleanup() { SecurityContextHolder.clearContext(); context.close(); }

    @Test
    void onlyTeacherCanInvokeTheEndpoint() {
        for (Role role : new Role[] { Role.STUDENT, Role.ADMIN }) {
            var caller = authenticate(role);
            assertThatThrownBy(() -> controller.update(caller, classId, request)).isInstanceOf(AccessDeniedException.class);
        }
        verifyNoInteractions(service);
        var teacher = authenticate(Role.TEACHER);
        controller.update(teacher, classId, request);
        verify(service).update(teacher, classId, request);
    }

    @Test
    void anonymousCallerCannotUpdateAudio() {
        assertThatThrownBy(() -> controller.update(null, classId, request))
                .isInstanceOf(AuthenticationCredentialsNotFoundException.class);
        verifyNoInteractions(service);
    }

    private AuthenticatedUser authenticate(Role role) {
        var caller = new AuthenticatedUser(teacherId, null, role);
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                caller, null, List.of(new SimpleGrantedAuthority("ROLE_" + role.name()))));
        return caller;
    }
}
