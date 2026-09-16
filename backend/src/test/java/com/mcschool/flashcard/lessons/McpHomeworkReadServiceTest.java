package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.notifications.AppLinks;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class McpHomeworkReadServiceTest {

    private UserRepository userRepository;
    private HomeworkRepository homeworkRepository;
    private StudentGroupMemberRepository groupMemberRepository;
    private GoogleCalendarLessonService calendarLessonService;
    private McpHomeworkReadService service;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        homeworkRepository = mock(HomeworkRepository.class);
        groupMemberRepository = mock(StudentGroupMemberRepository.class);
        calendarLessonService = mock(GoogleCalendarLessonService.class);
        service = new McpHomeworkReadService(
                userRepository,
                homeworkRepository,
                groupMemberRepository,
                calendarLessonService,
                new AppLinks("https://app.mindcrafti.de/"));
    }

    @Test
    void returnsNewestSubmissionsAndSeparatesThoseAfterLatestLesson() {
        User teacher = activeTeacher("Teacher A");
        teacher.connectGoogleCalendar("refresh-token");
        User student = activeStudent("Christian", teacher);

        Instant lessonStart = Instant.parse("2026-09-14T15:00:00Z");
        Instant lessonEnd = Instant.parse("2026-09-14T16:00:00Z");
        GroupLessonResponse lesson = new GroupLessonResponse(
                "event-1",
                "series-1",
                null,
                null,
                student.getId(),
                student.getFullName(),
                "Christian",
                lessonStart,
                lessonEnd,
                null,
                null);

        Homework beforeLesson = submittedHomework(
                student,
                LocalDate.of(2026, 9, 13),
                "before.pdf",
                Instant.parse("2026-09-14T14:30:00Z"));
        Homework firstAfterLesson = submittedHomework(
                student,
                LocalDate.of(2026, 9, 14),
                "first-after.pdf",
                Instant.parse("2026-09-14T17:00:00Z"));
        Homework newest = submittedHomework(
                student,
                LocalDate.of(2026, 9, 15),
                "newest.pdf",
                Instant.parse("2026-09-15T18:00:00Z"));

        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));
        when(homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId()))
                .thenReturn(List.of(beforeLesson, firstAfterLesson, newest));
        when(calendarLessonService.listGroupLessons(org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of(lesson));

        Map<String, Object> result = service.recentSubmissions(null, true, student.getId(), 5);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> recent = (List<Map<String, Object>>) result.get("recentSubmissions");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> afterLesson = (List<Map<String, Object>>) result.get("submittedAfterLatestLesson");

        assertThat(recent).extracting(row -> row.get("submittedFilename"))
                .containsExactly("newest.pdf", "first-after.pdf", "before.pdf");
        assertThat(afterLesson).extracting(row -> row.get("submittedFilename"))
                .containsExactly("newest.pdf", "first-after.pdf");
        assertThat(afterLesson.get(0).get("teacherSiteUrl"))
                .isEqualTo("https://app.mindcrafti.de/teacher/students/" + student.getId()
                        + "/homeworks/" + newest.getId());
        assertThat(result.get("submittedAfterLatestLessonCount")).isEqualTo(2);
    }

    @Test
    void downloadsActualSubmittedPdfFromMindcraftiDatabase() {
        User teacher = activeTeacher("Teacher A");
        User student = activeStudent("Melissa", teacher);
        Homework homework = submittedHomework(
                student,
                LocalDate.of(2026, 9, 15),
                "melissa-homework.pdf",
                Instant.parse("2026-09-15T19:30:00Z"));
        byte[] expectedPdf = "%PDF-1.7\nhello".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        homework.submitWorksheet("melissa-homework.pdf", expectedPdf, Instant.parse("2026-09-15T19:30:00Z"));

        when(homeworkRepository.findById(homework.getId())).thenReturn(Optional.of(homework));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));

        Map<String, Object> result = service.submissionPdf(null, true, homework.getId());

        assertThat(result.get("filename")).isEqualTo("melissa-homework.pdf");
        assertThat(result.get("base64"))
                .isEqualTo(java.util.Base64.getEncoder().encodeToString(expectedPdf));
        assertThat(result.get("teacherSiteUrl"))
                .isEqualTo("https://app.mindcrafti.de/teacher/students/" + student.getId()
                        + "/homeworks/" + homework.getId());
    }

    @Test
    void teacherCannotReadAnotherTeachersStudent() {
        User owner = activeTeacher("Owner");
        User otherTeacher = activeTeacher("Other");
        User student = activeStudent("Student", owner);
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));

        assertThatThrownBy(() -> service.recentSubmissions(otherTeacher, false, student.getId(), 5))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Teachers can access only their own students");
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

    private Homework submittedHomework(User student, LocalDate assignedDate, String filename, Instant submittedAt) {
        Homework homework = Homework.create(student, assignedDate);
        homework.attachWorksheet("worksheet.pdf", "%PDF-1.7\nworksheet".getBytes(java.nio.charset.StandardCharsets.UTF_8), 1);
        homework.submitWorksheet(filename, "%PDF-1.7\nsubmission".getBytes(java.nio.charset.StandardCharsets.UTF_8), submittedAt);
        return homework;
    }
}
