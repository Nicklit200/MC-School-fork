package com.mcschool.flashcard.skills;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
class SkillBoardAccessTest {
    @Configuration @EnableMethodSecurity
    static class Config {
        @Bean SkillBoardService service(){return mock(SkillBoardService.class);}
        @Bean SkillBoardController controller(SkillBoardService service){return new SkillBoardController(service);}
    }
    AnnotationConfigApplicationContext context;
    @BeforeEach void setup(){context=new AnnotationConfigApplicationContext(Config.class);}
    @AfterEach void close(){SecurityContextHolder.clearContext();context.close();}
    void role(String value){SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("test","",List.of(new SimpleGrantedAuthority("ROLE_"+value))));}
    @Test void studentsAndParentsCannotRead() {
        for(String value:List.of("STUDENT","PARENT")){role(value);assertThrows(AccessDeniedException.class,()->context.getBean(SkillBoardController.class).get("grade-6"));}
    }
    @Test void teacherReadsButCannotWrite() {
        role("TEACHER");var controller=context.getBean(SkillBoardController.class);controller.get("grade-6");
        assertThrows(AccessDeniedException.class,()->controller.save("grade-6",null,new AuthenticatedUser(UUID.randomUUID(),"test",Role.TEACHER)));
    }
    @Test void adminCanReadAndWrite() {
        role("ADMIN");var controller=context.getBean(SkillBoardController.class);controller.get("grade-6");
        controller.save("grade-6",null,new AuthenticatedUser(UUID.randomUUID(),"test",Role.ADMIN));
        verify(context.getBean(SkillBoardService.class)).save(eq("grade-6"),isNull(),any());
    }
}
