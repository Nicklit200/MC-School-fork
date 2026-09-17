package com.mcschool.flashcard.staging;

import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Creates disposable test accounts in the isolated staging environment. */
@Component
public class StagingFixturesInitializer implements ApplicationRunner {

    public static final String TEACHER_EMAIL = "test-teacher@mindcrafti.local";
    public static final String STUDENT_EMAIL = "test-student@mindcrafti.local";
    public static final String STUDENT_USERNAME = "test-student";

    private static final String SAMPLE_FILENAME = "staging-answer-input-test-v2.pdf";
    private static final String SAMPLE_ANSWER_KEY = "[{\"label\":\"1\",\"answer\":\"3/4\"},{\"label\":\"2\",\"answer\":\"60€\"}]";

    private static final String SECOND_SAMPLE_FILENAME = "staging-answer-input-test-v3.pdf";
    private static final String SECOND_SAMPLE_ANSWER_KEY = "[{\"label\":\"1\",\"answer\":\"5/6\"},{\"label\":\"2\",\"answer\":\"90€\"}]";

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final PasswordEncoder passwordEncoder;
    private final boolean enabled;
    private final String teacherPassword;
    private final String studentPassword;

    public StagingFixturesInitializer(
            UserRepository userRepository,
            HomeworkRepository homeworkRepository,
            PasswordEncoder passwordEncoder,
            @Value("${STAGING_FIXTURES_ENABLED:false}") boolean configuredEnabled,
            @Value("${RAILWAY_PROJECT_NAME:}") String railwayProjectName,
            @Value("${RAILWAY_SERVICE_NAME:}") String railwayServiceName,
            @Value("${STAGING_TEACHER_PASSWORD:staging-teacher-local-only}") String teacherPassword,
            @Value("${STAGING_STUDENT_PASSWORD:staging-student-local-only}") String studentPassword) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.passwordEncoder = passwordEncoder;
        this.enabled = configuredEnabled || isDedicatedStaging(railwayProjectName, railwayServiceName);
        this.teacherPassword = teacherPassword;
        this.studentPassword = studentPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws Exception {
        if (!enabled) return;

        User teacher = upsertTeacher();
        User student = upsertStudent(teacher);
        ensureSampleHomework(student);
        ensureSecondSampleHomework(student);
    }

    private User upsertTeacher() {
        String hash = passwordEncoder.encode(teacherPassword);
        User teacher = userRepository.findByEmail(TEACHER_EMAIL).orElse(null);
        if (teacher == null) {
            teacher = User.invitedTeacher(
                    "Test Teacher",
                    TEACHER_EMAIL,
                    "staging-teacher-" + UUID.randomUUID(),
                    Instant.now().plus(1, ChronoUnit.DAYS));
            teacher.activate(hash);
            return userRepository.save(teacher);
        }
        if (teacher.getRole() != Role.TEACHER || teacher.isArchived()) {
            throw new IllegalStateException("Staging teacher fixture conflicts with an existing account");
        }
        teacher.changeFullName("Test Teacher");
        if (teacher.getStatus() == UserStatus.INVITED) teacher.activate(hash);
        else teacher.changePasswordHash(hash);
        return teacher;
    }

    private User upsertStudent(User teacher) {
        String hash = passwordEncoder.encode(studentPassword);
        User student = userRepository.findByEmail(STUDENT_EMAIL)
                .or(() -> userRepository.findByUsernameIgnoreCase(STUDENT_USERNAME))
                .orElse(null);
        if (student == null) {
            student = User.invitedStudent(
                    "Test Student",
                    STUDENT_EMAIL,
                    teacher,
                    "staging-student-" + UUID.randomUUID(),
                    Instant.now().plus(1, ChronoUnit.DAYS));
            student.assignUsername(STUDENT_USERNAME);
            student.activate(hash);
            return userRepository.save(student);
        }
        if (student.getRole() != Role.STUDENT || student.isArchived()) {
            throw new IllegalStateException("Staging student fixture conflicts with an existing account");
        }
        student.changeFullName("Test Student");
        student.assignEmail(STUDENT_EMAIL);
        student.assignUsername(STUDENT_USERNAME);
        student.assignTeacher(teacher);
        if (student.getStatus() == UserStatus.INVITED) student.activate(hash);
        else student.changePasswordHash(hash);
        return student;
    }

    private void ensureSampleHomework(User student) throws Exception {
        ensureHomework(
                student,
                SAMPLE_FILENAME,
                SAMPLE_ANSWER_KEY,
                "1. Calculate: 1/2 + 1/4",
                "2. An item costs 80 EUR. After a 25% discount, what is the final price?");
    }

    private void ensureSecondSampleHomework(User student) throws Exception {
        ensureHomework(
                student,
                SECOND_SAMPLE_FILENAME,
                SECOND_SAMPLE_ANSWER_KEY,
                "1. Calculate: 1/2 + 1/3",
                "2. An item costs 120 EUR. After a 25% discount, what is the final price?");
    }

    private void ensureHomework(User student,
                                String filename,
                                String answerKey,
                                String taskOne,
                                String taskTwo) throws Exception {
        List<Homework> existing = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId());
        Homework current = existing.stream()
                .filter(homework -> filename.equals(homework.getWorksheetFilename()))
                .filter(homework -> !homework.isSubmissionComplete())
                .findFirst()
                .orElse(null);
        if (current != null) {
            current.configureFinalAnswerKey(2, answerKey);
            return;
        }

        boolean alreadyExists = existing.stream()
                .anyMatch(homework -> filename.equals(homework.getWorksheetFilename()));
        if (alreadyExists) return;

        Homework homework = Homework.create(student, LocalDate.now(ZoneId.of("Europe/Berlin")));
        homework.attachWorksheet(filename, samplePdf(taskOne, taskTwo), 1);
        homework.configureFinalAnswerKey(2, answerKey);
        homeworkRepository.save(homework);
    }

    private byte[] samplePdf(String taskOne, String taskTwo) throws Exception {
        try (PDDocument document = new PDDocument();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(PDRectangle.A4);
            document.addPage(page);
            PDType1Font title = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            PDType1Font text = new PDType1Font(Standard14Fonts.FontName.HELVETICA);

            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                content.beginText();
                content.setFont(title, 18);
                content.newLineAtOffset(60, 780);
                content.showText("Mindcrafti staging - final answer test");
                content.setFont(text, 13);
                content.setLeading(34);
                content.newLine();
                content.newLine();
                content.showText(taskOne);
                content.newLine();
                content.showText(taskTwo);
                content.newLine();
                content.newLine();
                content.showText("Solve both tasks. Submit the PDF, then enter the two final answers below it.");
                content.endText();
            }
            document.save(output);
            return output.toByteArray();
        }
    }

    private static boolean isDedicatedStaging(String projectName, String serviceName) {
        return "mindcrafti-staging".equalsIgnoreCase(projectName == null ? "" : projectName.trim())
                && "staging-api".equalsIgnoreCase(serviceName == null ? "" : serviceName.trim());
    }
}
