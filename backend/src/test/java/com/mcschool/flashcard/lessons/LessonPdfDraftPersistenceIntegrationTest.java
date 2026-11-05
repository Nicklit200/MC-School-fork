package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

/** Actual Flyway schema and PgJDBC binding, not a mocked JdbcTemplate. */
@SpringBootTest
@EnabledIf("databaseAvailable")
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class LessonPdfDraftPersistenceIntegrationTest {
    @Autowired private LessonPdfDraftService drafts;
    @Autowired private LessonPreparationService preparations;
    @Autowired private LessonPreparationRepository preparationRows;
    @Autowired private UserRepository users;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ObjectMapper json;
    @MockitoBean private SchoolBrandGuideService brand;
    private AuthenticatedUser teacher;
    private BufferedImage logo;
    private byte[] workbook;
    private byte[] answers;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) { McpTestDatabase.properties(properties); }
    static boolean databaseAvailable() { return McpTestDatabase.available(); }
    @AfterAll
    static void stopDatabase() { McpTestDatabase.stop(); }

    @BeforeEach
    void setup() throws Exception {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        User account=users.saveAndFlush(User.activeTeacher("Teacher","draft@teacher.test","draft-teacher","unused"));
        teacher=new AuthenticatedUser(account.getId(),account.getEmail(),account.getRole());
        logo=new BufferedImage(160,120,BufferedImage.TYPE_INT_RGB);
        var brush=logo.createGraphics();
        brush.setColor(Color.ORANGE); brush.fillRect(0,0,160,120); brush.dispose();
        List<LessonPdfDraftService.Task> tasks=List.of(new LessonPdfDraftService.Task("Berechne 2 + 3.","5",3));
        workbook=LessonPdfDraftService.render("Mathematik","Sofia",tasks,logo,false,"");
        answers=LessonPdfDraftService.render("Mathematik","Sofia",tasks,logo,true,"");
        when(brand.pdfForStaff(teacher)).thenReturn(new SchoolBrandGuideService.BrandGuidePdf("guide.pdf",workbook));
    }

    @Test
    void legacyCreatePersistsCreatedAtUsingRealPostgresDriver() throws Exception {
        String lesson=json.writeValueAsString(Map.of("title","Mathematik","tasks",List.of(
                Map.of("question","Berechne 2 + 3.","answer","5","lines",3),
                Map.of("question","Berechne 4 + 2.","answer","6","lines",3))));
        Map<String,Object> result=drafts.create(teacher,"legacy-event","Sofia",lesson);
        UUID id=UUID.fromString(String.valueOf(result.get("draftId")));
        assertStoredDraft(id,"legacy-event",2);
        assertThat(preparationRows.count()).isZero();
    }

    @Test
    void rendererCreatePersistsExactPdfPairAndCreatedAtWithoutPublishing() throws Exception {
        Map<String,Object> result=drafts.createFromRenderer(teacher,"renderer-event",workbook,answers,"plan","",1,logo);
        UUID id=UUID.fromString(String.valueOf(result.get("draftId")));
        assertStoredDraft(id,"renderer-event",1);
        assertThat(jdbc.queryForObject("SELECT workbook_pdf FROM lesson_pdf_drafts WHERE id=?",byte[].class,id)).isEqualTo(workbook);
        assertThat(jdbc.queryForObject("SELECT answers_pdf FROM lesson_pdf_drafts WHERE id=?",byte[].class,id)).isEqualTo(answers);
        assertThat(preparationRows.count()).isZero();
    }

    @Test
    void publicationPersistsPublishedAtAndExactApprovedPairAndReplayDoesNotRewriteSlots() throws Exception {
        String event="approved-event";
        preparations.update(teacher,event,new UpdateLessonPreparationRequest("keep-homework","keep-difficulties","keep-plan","keep-transcript"));
        Map<String,Object> draft=drafts.createFromRenderer(teacher,event,workbook,answers,"draft-plan","",1,logo);
        UUID id=UUID.fromString(String.valueOf(draft.get("draftId")));
        assertThatThrownBy(()->drafts.publish(teacher,id,false)).isInstanceOf(IllegalArgumentException.class);
        assertStoredDraft(id,event,1);
        Map<String,Object> result=drafts.publish(teacher,id,true);
        assertThat(result).containsEntry("success",true).containsEntry("eventId",event).containsEntry("hasWorkbook",true).containsEntry("hasAnswers",true);
        assertThat(jdbc.queryForObject("SELECT status FROM lesson_pdf_drafts WHERE id=?",String.class,id)).isEqualTo("PUBLISHED");
        assertThat(jdbc.queryForObject("SELECT published_at FROM lesson_pdf_drafts WHERE id=?",Timestamp.class,id)).isNotNull();
        var stored=preparationRows.findByTeacherIdAndEventId(teacher.id(),event).orElseThrow();
        assertThat(stored.getWorkbookPdf()).isEqualTo(workbook);
        assertThat(stored.getAnswersPdf()).isEqualTo(answers);
        assertThat(stored.getWorkbookFilename()).isEqualTo(draft.get("workbookFilename"));
        assertThat(stored.getAnswersFilename()).isEqualTo(draft.get("answersFilename"));
        assertThat(stored.getHomeworkNotes()).isEqualTo("keep-homework");
        assertThat(stored.getTranscriptText()).isEqualTo("keep-transcript");
        assertThat(stored.getLessonPlan()).isEqualTo("keep-plan");
        assertThat(stored.getDifficulties()).isEqualTo("keep-difficulties");
        long workbookVersion=stored.getWorkbookVersion(), answersVersion=stored.getAnswersVersion();
        assertThat(drafts.publish(teacher,id,true)).containsEntry("alreadyPublished",true);
        var replay=preparationRows.findByTeacherIdAndEventId(teacher.id(),event).orElseThrow();
        assertThat(replay.getWorkbookVersion()).isEqualTo(workbookVersion);
        assertThat(replay.getAnswersVersion()).isEqualTo(answersVersion);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM lesson_pdf_drafts",Integer.class)).isEqualTo(1);
    }

    private void assertStoredDraft(UUID id,String event,int tasks) {
        assertThat(jdbc.queryForObject("SELECT event_id FROM lesson_pdf_drafts WHERE id=?",String.class,id)).isEqualTo(event);
        assertThat(jdbc.queryForObject("SELECT teacher_id FROM lesson_pdf_drafts WHERE id=?",UUID.class,id)).isEqualTo(teacher.id());
        assertThat(jdbc.queryForObject("SELECT status FROM lesson_pdf_drafts WHERE id=?",String.class,id)).isEqualTo("DRAFT");
        assertThat(jdbc.queryForObject("SELECT task_count FROM lesson_pdf_drafts WHERE id=?",Integer.class,id)).isEqualTo(tasks);
        Timestamp created=jdbc.queryForObject("SELECT created_at FROM lesson_pdf_drafts WHERE id=?",Timestamp.class,id);
        assertThat(created).isNotNull();
        assertThat(created.toInstant()).isBetween(Instant.now().minusSeconds(60),Instant.now().plusSeconds(1));
        assertThat(jdbc.queryForObject("SELECT published_at FROM lesson_pdf_drafts WHERE id=?",Timestamp.class,id)).isNull();
    }
}
