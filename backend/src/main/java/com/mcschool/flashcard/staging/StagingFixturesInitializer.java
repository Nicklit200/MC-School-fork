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

/**
 * Creates disposable test accounts only when explicitly enabled in the isolated staging environment.
 * The flag defaults to false, so this class is inert everywhere else, including production.
 */
@Component
public class StagingFixturesInitializer implements ApplicationRunner {

    public static final String TEACHER_EMAIL = "test-teacher@mindcrafti.local";
    public static final String STUDENT_EMAIL = "test-student@mindcrafti.local";
    public static final String STUDENT_USERNAME = "test-student";
    private static final String SAMPLE_FILENAME = "staging-answer-input-test.pdf";

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
            @Value("${STAGING_FIXTURES_ENABLED:false}") boolean enabled,
            @Value("${STAGING_TEACHER_PASSWORD:}") String teacherPassword,
            @Value("${STAGING_STUDENT_PASSWORD:}") String studentPassword) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.passwordEncoder = passwordEncoder;
        this.enabled = enabled;
        this.teacherPassword = teacherPassword;
        this.studentPassword = studentPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws Exception {
        if (!enabled) return;
        if (teacherPassword.isBlank() || studentPassword.isBlank()) {
            throw new IllegalStateException("Staging fixture passwords must be configured when fixtures are enabled");
        }

        User teacher = upsertTeacher();
        User student = upsertStudent(teacher);
        ensureSampleHomework(student);
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
        boolean exists = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId()).stream()
                .anyMatch(homework -> SAMPLE_FILENAME.equals(homework.getWorksheetFilename()) && !homework.isSubmitted());
        if (exists) return;

        Homework homework = Homework.create(student, LocalDate.now(ZoneId.of("Europe/Berlin")));
        homework.attachWorksheet(SAMPLE_FILENAME, samplePdf(), 1);
        homeworkRepository.save(homework);
    }

    private byte[] samplePdf() throws Exception {
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
                content.showText("Mindcrafti staging - answer input test");
                content.setFont(text, 13);
                content.setLeading(30);
                content.newLine();
                content.newLine();
                content.showText("1. Calculate: 1/2 + 1/4");
                content.newLine();
                content.showText("2. Calculate: 25% of 80");
                content.newLine();
                content.showText("3. Calculate: -7 + 3");
                content.newLine();
                content.showText("4. Solve: x + 5 = 35");
                content.newLine();
                content.newLine();
                content.showText("Write your work here, then enter the final answers at the bottom of the page.");
                content.endText();
            }
            document.save(output);
            return output.toByteArray();
        }
    }
}
