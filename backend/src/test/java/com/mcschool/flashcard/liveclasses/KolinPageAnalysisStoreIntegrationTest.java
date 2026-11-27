package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.lessons.GoogleCalendarLessonService;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@TestPropertySource(properties={"app.online-classes.enabled=true",
        "app.completed-lesson-report.initial-ms=86400000",
        "app.post-lesson-skill-review.initial-ms=86400000"})
@Testcontainers(disabledWithoutDocker=true)
class KolinPageAnalysisStoreIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE=new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired UserRepository users;
    @Autowired OnlineClassRepository classes;
    @Autowired OnlineClassAnnotationDocumentRepository documents;
    @Autowired OnlineClassAnnotationEventRepository events;
    @Autowired JdbcTemplate jdbc;
    @Autowired KolinPageAnalysisStore store;
    @MockitoBean GoogleCalendarLessonService calendar;
    User teacher,pupil;
    OnlineClass room;
    OnlineClassAnnotationDocument page;
    String board;

    @DynamicPropertySource static void database(DynamicPropertyRegistry props){
        props.add("spring.datasource.url",DATABASE::getJdbcUrl);
        props.add("spring.datasource.username",DATABASE::getUsername);
        props.add("spring.datasource.password",DATABASE::getPassword);
        props.add("app.online-classes.idle-sweep-initial-ms",()->"86400000");
    }

    @BeforeEach void seed(){
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher=users.saveAndFlush(User.activeTeacher("Owner","owner@analysis.test","analysis-owner","unused"));
        pupil=users.saveAndFlush(User.managedStudent("Pupil",teacher));
        Instant now=Instant.now();
        room=OnlineClass.forStudent(teacher,"analysis-event","analysis-event","Math",now.minusSeconds(60),now.plusSeconds(3600),pupil);
        room.start(now.minusSeconds(60));room=classes.saveAndFlush(room);
        board=PersonalBoard.targetIdFor(pupil.getId());
        page=documents.saveAndFlush(OnlineClassAnnotationDocument.create(room,AnnotationTargetType.WHITEBOARD,board,0));
    }

    private void write(User actor,User owner,AnnotationOperationType operation){
        long revision=page.nextRevision();
        page=documents.saveAndFlush(page);
        events.saveAndFlush(OnlineClassAnnotationEvent.record(page,UUID.randomUUID(),revision,actor,owner,operation,"{}"));
    }

    private KolinPageAnalysisStore.Key key(){
        return new KolinPageAnalysisStore.Key(room.getId(),teacher.getId(),pupil.getId(),board,1,0,0,page.getRevision());
    }
    private java.util.List<KolinPageAnalysisStore.Candidate> candidates(){
        return store.candidates(room.getId(),teacher.getId(),pupil.getId(),board,0,0);
    }
    private java.util.List<KolinPageAnalysisStore.SavedResult> current(){
        return store.current(room.getId(),teacher.getId(),pupil.getId(),board,0,0);
    }
    private java.util.List<KolinPageAnalysisStore.SavedResult> current(long documentVersion){
        return store.current(room.getId(),teacher.getId(),pupil.getId(),board,documentVersion,0);
    }

    @Test void manualChecksOnlyNewPupilInkAndDeduplicateAcrossPdfVersions(){
        write(teacher,teacher,AnnotationOperationType.ADD);
        assertThat(candidates()).isEmpty();

        write(pupil,pupil,AnnotationOperationType.ADD);
        assertThat(candidates()).hasSize(1);
        assertThat(store.hasPupilInk(key())).isTrue();
        var first=store.claim(key(),"a".repeat(64));
        assertThat(first.acquired()).isTrue();
        store.finish(key(),first.result().id(),"First review");
        assertThat(current()).extracting(KolinPageAnalysisStore.SavedResult::text).containsExactly("First review");

        // Teacher ink changes the full board revision but not the pupil's review revision.
        write(teacher,teacher,AnnotationOperationType.ADD);
        assertThat(candidates()).isEmpty();
        var changedBoardRevision=key();
        assertThat(store.claim(changedBoardRevision,"b".repeat(64)).acquired()).isFalse();

        // A new pupil stroke makes exactly this pupil's page eligible again.
        write(pupil,pupil,AnnotationOperationType.ADD);
        assertThat(current()).hasSize(1);
        assertThat(current().get(0).isCurrent()).isFalse();
        assertThat(candidates()).hasSize(1);
        var next=store.claim(key(),"c".repeat(64));
        assertThat(next.acquired()).isTrue();
        assertThat(next.result().id()).isNotEqualTo(first.result().id());
        store.finish(key(),next.result().id(),"Second review");
        assertThat(current()).extracting(KolinPageAnalysisStore.SavedResult::text)
                .containsExactly("Second review","First review");
        assertThat(current()).filteredOn(KolinPageAnalysisStore.SavedResult::isCurrent)
                .extracting(KolinPageAnalysisStore.SavedResult::text).containsExactly("Second review");

        // Erasing/undoing old marks does not count as new writing and never sends a blank page.
        write(pupil,pupil,AnnotationOperationType.ERASE);
        assertThat(candidates()).isEmpty();
        assertThat(current()).allMatch(result -> !result.isCurrent());

        // A clear requires a fresh pupil ADD/UPDATE before another review.
        write(pupil,pupil,AnnotationOperationType.CLEAR_LAYER);
        assertThat(candidates()).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM kolyn_page_analyses",Integer.class)).isEqualTo(2);
    }
}
