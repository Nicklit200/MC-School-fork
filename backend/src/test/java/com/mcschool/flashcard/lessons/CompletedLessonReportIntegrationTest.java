package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties={"app.online-classes.enabled=true",
        "app.completed-lesson-report.initial-ms=86400000",
        "app.post-lesson-skill-review.initial-ms=86400000"})
@Testcontainers(disabledWithoutDocker=true)
class CompletedLessonReportIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE=new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private UserRepository users;
    @Autowired private OnlineClassRepository classes;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private CompletedLessonReportService reports;
    @MockitoBean private GoogleCalendarLessonService calendar;
    private User teacher,student,outsider,otherTeacher;
    private OnlineClass room;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties){
        properties.add("spring.datasource.url",DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username",DATABASE::getUsername);
        properties.add("spring.datasource.password",DATABASE::getPassword);
        properties.add("app.online-classes.idle-sweep-initial-ms",()->"86400000");
    }

    @BeforeEach void seed(){
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher=users.saveAndFlush(User.activeTeacher("Owner","owner@report.test","report-owner","unused"));
        otherTeacher=users.saveAndFlush(User.activeTeacher("Other","other@report.test","report-other","unused"));
        student=users.saveAndFlush(User.managedStudent("Pupil",teacher));
        outsider=users.saveAndFlush(User.managedStudent("Outside",teacher));
        Instant now=Instant.now();
        room=OnlineClass.forStudent(teacher,"report-event","report-event","Completed lesson",
                now.minusSeconds(3600),now,student);
        room.start(now.minusSeconds(3600));room.end(now);room=classes.saveAndFlush(room);
    }
    private UsernamePasswordAuthenticationToken account(User user){
        var principal=new AuthenticatedUser(user.getId(),null,user.getRole());
        return UsernamePasswordAuthenticationToken.authenticated(principal,"unused",
                List.of(new SimpleGrantedAuthority("ROLE_"+principal.role().name())));
    }
    private String path(){return "/api/v1/online-classes/"+room.getId()+"/completed-lesson-report";}
    private String request(UUID pupil,UUID id){
        return json.writeValueAsString(new CompletedLessonReportService.Request(pupil,id,"Check independent work"));
    }

    @Test void durableQueueIsIdempotentPrivateAndDoesNotWriteMasteryOrArchive()throws Exception{
        UUID id=UUID.randomUUID();
        mvc.perform(get(path()+"/recipients").with(authentication(account(teacher))))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(student.getId().toString()));
        mvc.perform(get(path()+"/recipients").with(authentication(account(otherTeacher))))
                .andExpect(status().isNotFound());
        mvc.perform(post(path()).contentType(MediaType.APPLICATION_JSON).content(request(outsider.getId(),UUID.randomUUID()))
                .with(authentication(account(teacher)))).andExpect(status().isNotFound());
        mvc.perform(post(path()).contentType(MediaType.APPLICATION_JSON).content(request(student.getId(),id))
                .with(authentication(account(teacher)))).andExpect(status().isAccepted()).andExpect(jsonPath("$.id").value(id.toString()));
        mvc.perform(post(path()).contentType(MediaType.APPLICATION_JSON).content(request(student.getId(),id))
                .with(authentication(account(teacher)))).andExpect(status().isAccepted()).andExpect(jsonPath("$.id").value(id.toString()));
        mvc.perform(post(path()).contentType(MediaType.APPLICATION_JSON).content(request(student.getId(),UUID.randomUUID()))
                .with(authentication(account(teacher)))).andExpect(status().isAccepted()).andExpect(jsonPath("$.id").value(id.toString()));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM completed_lesson_report_jobs",Integer.class));

        reports.tick();
        String state="";
        long until=System.nanoTime()+java.time.Duration.ofSeconds(10).toNanos();
        while(System.nanoTime()<until){
            state=jdbc.queryForObject("SELECT state FROM completed_lesson_report_jobs WHERE id=?",String.class,id);
            if("DONE".equals(state)||"FAILED".equals(state))break;
            Thread.sleep(50);
        }
        assertEquals("DONE",state);
        mvc.perform(get(path()).param("studentId",student.getId().toString()).with(authentication(account(teacher))))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].state").value("DONE"))
                .andExpect(jsonPath("$[0].report.observations").isEmpty());
        mvc.perform(get(path()+"/"+id+"/pdf").param("studentId",student.getId().toString())
                .with(authentication(account(teacher)))).andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF));
        mvc.perform(get(path()+"/"+id+"/pdf").param("studentId",student.getId().toString())
                .with(authentication(account(otherTeacher)))).andExpect(status().isNotFound());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM completed_lesson_documents",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM post_lesson_homework_jobs",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM post_lesson_skill_review_students",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM student_skill_evidence",Integer.class));
    }
}
