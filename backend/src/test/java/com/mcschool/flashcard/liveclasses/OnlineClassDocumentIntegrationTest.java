package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.lessons.LessonPreparationService;
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
    void answersAndSolutionsInPdfFilenameStillRemainAStudentWorkbook() {
        // These names would previously be misclassified as teacher-only answers,
        // making POST /workbook return 200 followed by GET /document returning 404.
        preparation(false, true);
        for (String filename : java.util.List.of(
                "math_answers.pdf", "lesson_solutions.pdf", "Ответы по математике.pdf",
                "Решения заданий.pdf", "Mathe Antworten und Lösungen.pdf")) {
            byte[] pdf = ("%PDF-1.4\\n% " + filename + "\\n%%EOF")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            var result = preparationService.uploadWorkbook(teacherPrincipal,
                    "event-doc", filename, pdf);
            assertThat(result.hasWorkbook()).isTrue();
            assertThat(result.hasAnswers()).isTrue();
            assertThat(documentService.workbook(studentPrincipal, onlineClass.getId()))
                    .contains(pdf);
            var stored = preparations.findByTeacherIdAndEventId(teacher.getId(), "event-doc")
                    .orElseThrow();
            assertThat(stored.getWorkbookFilename()).isEqualTo(filename);
            // Private answer PDF must never be changed or sent to the student.
            assertThat(stored.getAnswersPdf()).isEqualTo(ANSWERS);
        }
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
