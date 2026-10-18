package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.lessons.LessonPreparationService;
import java.io.ByteArrayOutputStream;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.springframework.web.server.ResponseStatusException;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/** The workbook becomes the shared board document; the answers never do. */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class OnlineClassDocumentIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);
    private static final byte[] WORKBOOK = "WORKBOOK-PDF".getBytes();
    private static final byte[] ANSWERS = "ANSWERS-PDF".getBytes();

    @Autowired
    private OnlineClassDocumentService documentService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private LessonPreparationRepository preparations;

    @Autowired
    private LessonPreparationService preparationService;

    @Autowired
    private UserRepository userRepository;

    private User teacher;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;
    private AuthenticatedUser outsiderPrincipal;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local", "t1", END));
        User student = userRepository.save(User.invitedStudent("Student", "student@test.local",
                teacher, "s1", END));
        User outsider = userRepository.save(User.invitedStudent("Outsider", "outsider@test.local",
                teacher, "s2", END));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        studentPrincipal = new AuthenticatedUser(student.getId(), student.getEmail(), student.getRole());
        outsiderPrincipal = new AuthenticatedUser(outsider.getId(), outsider.getEmail(), outsider.getRole());

        OnlineClass created = OnlineClass.forStudent(teacher, "event-doc", "binding-doc",
                "Maths", START, END, student);
        created.start(START);
        onlineClass = classRepository.save(created);
        ClassTestSupport.admit(participantRepository, onlineClass, student);
    }

    private void preparation(boolean workbook, boolean answers) {
        LessonPreparation prep = LessonPreparation.create(teacher, "event-doc");
        if (workbook) prep.attachWorkbook("workbook.pdf", WORKBOOK);
        if (answers) prep.attachAnswers("answers.pdf", ANSWERS);
        preparations.save(prep);
    }

    @Test
    void theTeacherAndTheBoundStudentReceiveTheWorkbook() {
        preparation(true, true);

        assertThat(documentService.workbook(teacherPrincipal, onlineClass.getId())).contains(WORKBOOK);
        assertThat(documentService.workbook(studentPrincipal, onlineClass.getId())).contains(WORKBOOK);
    }

    @Test
    void theAnswersFileIsNeverServedEvenWhenItIsTheOnlyUpload() {
        preparation(false, true);

        // Answers exist, but this route only ever reads the workbook.
        assertThat(documentService.workbook(studentPrincipal, onlineClass.getId())).isEmpty();
        assertThat(documentService.workbook(teacherPrincipal, onlineClass.getId())).isEmpty();
    }

    @Test
    void filenamesMentioningAnswersStillUploadToWorkbookSlotOnIPad() {
        byte[] pdf = "%PDF-1.4\\n1 0 obj\\n<< >>\\nendobj\\n%%EOF".getBytes();
        var result = preparationService.uploadWorkbook(teacherPrincipal,
                "event-doc", "Mathe Antworten und Lösungen.pdf", pdf);

        assertThat(result.hasWorkbook()).isTrue();
        assertThat(result.hasAnswers()).isFalse();
        assertThat(documentService.workbook(studentPrincipal, onlineClass.getId()))
                .contains(pdf);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event-doc")
                .orElseThrow().getWorkbookFilename()).isEqualTo("Mathe Antworten und Lösungen.pdf");
    }

    @Test
    void explicitLegacyAnswersPrefixKeepsOldMcpClientsCompatible() {
        byte[] pdf = "%PDF-1.4\\n%%EOF".getBytes();
        var result = preparationService.uploadWorkbook(teacherPrincipal,
                "event-doc", "__answers__:teacher-solutions.pdf", pdf);

        assertThat(result.hasWorkbook()).isFalse();
        assertThat(result.hasAnswers()).isTrue();
        assertThat(documentService.workbook(studentPrincipal, onlineClass.getId())).isEmpty();
    }

    @Test
    void anEmptyIPadUploadMustNotReportSuccess() {
        assertThatThrownBy(() -> preparationService.uploadWorkbook(
                teacherPrincipal, "event-doc", "Aufgaben.pdf", new byte[0]))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("non-empty PDF");
        assertThat(preparations.findByTeacherIdAndEventId(
                teacher.getId(), "event-doc")).isEmpty();
    }

    private byte[] pdfWithPages(int pages) throws Exception {
        try (var doc = new PDDocument(); var out = new ByteArrayOutputStream()) {
            for (int index = 0; index < pages; index++) doc.addPage(new PDPage());
            doc.save(out);
            return out.toByteArray();
        }
    }

    @Test
    void appendWorkbookKeepsAllOriginalPagesAndExposesMoreToStudents() throws Exception {
        byte[] original = pdfWithPages(2);
        byte[] second = pdfWithPages(3);
        preparationService.appendWorkbook(teacherPrincipal, "event-doc", "first.pdf", original);
        assertThat(documentService.workbookVersion(studentPrincipal, onlineClass.getId())).isPositive();
        var originalVersion = documentService.workbookVersion(studentPrincipal, onlineClass.getId());
        preparationService.appendWorkbook(teacherPrincipal, "event-doc", "second.pdf", second);
        assertThat(documentService.workbookVersion(studentPrincipal, onlineClass.getId()))
                .isGreaterThan(originalVersion);
        byte[] joined = documentService.workbook(studentPrincipal, onlineClass.getId()).orElseThrow();
        try (var merged = Loader.loadPDF(joined)) {
            assertThat(merged.getNumberOfPages()).isEqualTo(5);
        }
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event-doc")
                .orElseThrow().hasAnswers()).isFalse();
    }

    @Test
    void malformedSecondFileDoesNotOverwriteExistingWorkbook() throws Exception {
        byte[] first = pdfWithPages(2);
        preparationService.appendWorkbook(teacherPrincipal, "event-doc", "first.pdf", first);
        assertThatThrownBy(() -> preparationService.appendWorkbook(teacherPrincipal,
                "event-doc", "bad.pdf", "%PDF-corrupted".getBytes()))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThat(documentService.workbook(studentPrincipal, onlineClass.getId())).contains(first);
    }

    @Test
    void aLessonWithoutPreparationHasNoDocument() {
        assertThat(documentService.workbook(studentPrincipal, onlineClass.getId())).isEmpty();
    }

    @Test
    void homeworkNotesAreSharedWithoutPrivateSolutionsOrPlanning() {
        LessonPreparation prep = LessonPreparation.create(teacher, "event-doc");
        prep.updateNotes("Solve 1–5", "private difficulties", "private lesson plan", "private transcript");
        prep.attachWorkbook("tasks.pdf", WORKBOOK);
        prep.attachAnswers("private-answers.pdf", ANSWERS);
        preparations.save(prep);

        var shared = documentService.homework(studentPrincipal, onlineClass.getId());
        assertThat(shared).isEqualTo(documentService.homework(teacherPrincipal, onlineClass.getId()));
        assertThat(shared.notes()).isEqualTo("Solve 1–5");
        assertThat(shared.hasDocument()).isTrue();
        assertThat(shared.toString()).doesNotContain("private", "answers");
    }

    @Test
    void homeworkWithoutPreparationIsEmpty() {
        var shared = documentService.homework(studentPrincipal, onlineClass.getId());
        assertThat(shared.notes()).isNull();
        assertThat(shared.hasDocument()).isFalse();
    }

    @Test
    void anOutsiderCannotTellThisClassExists() {
        preparation(true, false);

        assertThatThrownBy(() -> documentService.workbook(outsiderPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> documentService.homework(outsiderPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
