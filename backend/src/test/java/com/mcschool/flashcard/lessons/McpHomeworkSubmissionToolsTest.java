package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.notifications.AppLinks;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class McpHomeworkSubmissionToolsTest {

    private UserRepository userRepository;
    private HomeworkRepository homeworkRepository;
    private McpHomeworkReadService service;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        homeworkRepository = mock(HomeworkRepository.class);
        service = new McpHomeworkReadService(
                userRepository,
                homeworkRepository,
                mock(StudentGroupMemberRepository.class),
                mock(GoogleCalendarLessonService.class),
                new AppLinks("https://app.mindcrafti.de/"));
    }

    @Test
    void findsStudentHomeworksInsideInclusiveDateRange() {
        User teacher = activeTeacher("Teacher A");
        User student = activeStudent("Vitalina", teacher);

        Homework beforeRange = Homework.create(student, LocalDate.of(2026, 9, 10));
        beforeRange.attachWorksheet("before.pdf", fakePdf(), 1);

        Homework insideRange = Homework.create(student, LocalDate.of(2026, 9, 13));
        insideRange.attachWorksheet("inside.pdf", fakePdf(), 1);
        insideRange.submitWorksheet(
                "inside-submitted.pdf",
                fakePdf(),
                Instant.parse("2026-09-13T16:00:00Z"));

        Homework afterRange = Homework.create(student, LocalDate.of(2026, 9, 16));
        afterRange.attachWorksheet("after.pdf", fakePdf(), 1);

        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));
        when(homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId()))
                .thenReturn(List.of(afterRange, insideRange, beforeRange));

        Map<String, Object> result = service.findStudentHomeworks(
                null,
                true,
                student.getId(),
                LocalDate.of(2026, 9, 11),
                LocalDate.of(2026, 9, 15));

        assertThat(result.get("homeworkCount")).isEqualTo(1);
        assertThat(result.get("submittedCount")).isEqualTo(1L);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> homeworks = (List<Map<String, Object>>) result.get("homeworks");
        assertThat(homeworks).hasSize(1);
        assertThat(homeworks.get(0).get("homeworkId")).isEqualTo(insideRange.getId().toString());
        assertThat(homeworks.get(0).get("assignedDate")).isEqualTo("2026-09-13");
        assertThat(homeworks.get(0).get("submitted")).isEqualTo(true);
        assertThat(homeworks.get(0).get("mcpSubmissionTool")).isEqualTo("get_homework_submission");
        assertThat(homeworks.get(0).get("mcpPagesTool")).isEqualTo("get_homework_submission_pages");
    }

    @Test
    void rendersActualSubmittedPdfPagesAsPng() throws Exception {
        User teacher = activeTeacher("Teacher A");
        User student = activeStudent("Vitalina", teacher);
        byte[] submittedPdf = twoPagePdf();

        Homework homework = Homework.create(student, LocalDate.of(2026, 9, 15));
        homework.attachWorksheet("worksheet.pdf", submittedPdf, 2);
        homework.submitWorksheet(
                "vitalina-submitted.pdf",
                submittedPdf,
                Instant.parse("2026-09-15T18:45:01Z"));

        when(homeworkRepository.findById(homework.getId())).thenReturn(Optional.of(homework));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));

        Map<String, Object> result = service.submissionPages(null, true, homework.getId(), 1, 1);

        assertThat(result.get("totalPageCount")).isEqualTo(2);
        assertThat(result.get("renderedPageCount")).isEqualTo(1);
        assertThat(result.get("nextStartPage")).isEqualTo(2);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> pages = (List<Map<String, Object>>) result.get("pages");
        assertThat(pages).hasSize(1);
        assertThat(pages.get(0).get("pageNumber")).isEqualTo(1);
        assertThat(pages.get(0).get("mimeType")).isEqualTo("image/png");
        assertThat((Integer) pages.get(0).get("widthPx")).isGreaterThan(0);
        assertThat((Integer) pages.get(0).get("heightPx")).isGreaterThan(0);

        byte[] png = Base64.getDecoder().decode((String) pages.get(0).get("base64"));
        assertThat(png.length).isGreaterThan(8);
        assertThat(png[0]).isEqualTo((byte) 0x89);
        assertThat(png[1]).isEqualTo((byte) 0x50);
        assertThat(png[2]).isEqualTo((byte) 0x4E);
        assertThat(png[3]).isEqualTo((byte) 0x47);
    }

    private byte[] twoPagePdf() throws IOException {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            document.addPage(new PDPage());
            document.save(out);
            return out.toByteArray();
        }
    }

    private byte[] fakePdf() {
        return "%PDF-1.7\nsubmission".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private User activeTeacher(String name) {
        User teacher = User.invitedTeacher(
                name,
                name.toLowerCase().replace(' ', '.') + "@example.com",
                UUID.randomUUID().toString(),
                Instant.now().plusSeconds(3600));
        teacher.activate("hash");
        return teacher;
    }

    private User activeStudent(String name, User teacher) {
        User student = User.invitedStudent(
                name,
                name.toLowerCase() + "@example.com",
                teacher,
                UUID.randomUUID().toString(),
                Instant.now().plusSeconds(3600));
        student.activate("hash");
        return student;
    }
}
