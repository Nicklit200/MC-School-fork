package com.mcschool.flashcard.skills;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.parents.ParentSkillProgressController;
import com.mcschool.flashcard.parents.ParentSkillProgressService;
import com.mcschool.flashcard.users.Role;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

/** Public board APIs remain protected; a parent may only use the child-scoped read endpoint. */
class ParentSkillsTreeAccessTest {
    @Configuration @EnableMethodSecurity
    static class Config {
        @Bean ParentSkillProgressService service() { return mock(ParentSkillProgressService.class); }
        @Bean ParentSkillProgressController controller(ParentSkillProgressService service) {
            return new ParentSkillProgressController(service);
        }
    }
    private AnnotationConfigApplicationContext context;
    private final UUID child = UUID.randomUUID();
    private final UUID parent = UUID.randomUUID();

    @BeforeEach void setup() { context = new AnnotationConfigApplicationContext(Config.class); }
    @AfterEach void close() { SecurityContextHolder.clearContext(); context.close(); }
    private void role(String name) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                "test", "", List.of(new SimpleGrantedAuthority("ROLE_" + name))));
    }

    @Test void onlyParentsCanReadChildTree() {
        var controller = context.getBean(ParentSkillProgressController.class);
        var principal = new AuthenticatedUser(parent, "parent@example.test", Role.PARENT);
        for (String other : List.of("STUDENT", "TEACHER", "ADMIN")) {
            role(other);
            assertThrows(AccessDeniedException.class, () -> controller.tree(principal, child));
        }
        role("PARENT");
        controller.tree(principal, child);
        verify(context.getBean(ParentSkillProgressService.class)).tree(principal, child);
    }
}
