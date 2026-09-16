package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkDeadlinePolicy;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only access to submitted PDF homework for the Mindcrafti MCP connector. */
@Service
public class McpHomeworkReadService {

    private static final ZoneId SCHOOL_ZONE = HomeworkDeadlinePolicy.SCHOOL_ZONE;
    private static final int MAX_RECENT_SUBMISSIONS = 10;
    private static final int MAX_DIRECT_PDF_BYTES = 15 * 1024 * 1024;

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final GoogleCalendarLessonService calendarLessonService;

    public McpHomeworkReadService(
            UserRepository userRepository,
            HomeworkRepository homeworkRepository,
            StudentGroupMemberRepository groupMemberRepository,
            GoogleCalendarLessonService calendarLessonService) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.calendarLessonService = calendarLessonService;
    }

    /**
     * Returns two views at once:
     * - recentSubmissions: the last N submitted PDFs overall;
     * - submittedAfterLatestLesson: the last N PDFs submitted after the student's latest completed lesson.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> recentSubmissions(
            User actor, boolean adminLike, UUID studentId, int limit) {
        if (limit < 1 || limit > MAX_RECENT_SUBMISSIONS) {
            throw new IllegalArgumentException("limit must be between 1 and " + MAX_RECENT_SUBMISSIONS);
        }

        User student = requireAccessibleStudent(actor, adminLike, studentId);
        GroupLessonResponse latestLesson = latestCompletedLesson(student);

        List<Homework> submitted = homeworkRepository
                .findAllByStudentIdOrderByStartDateDescCreatedAtDesc(studentId).stream()
                .filter(Homework::isSubmitted)
                .filter(homework -> homework.getSubmittedAt() != null)
                .sorted(Comparator.comparing(Homework::getSubmittedAt).reversed())
                .toList();

        List<Map<String, Object>> recent = submitted.stream()
                .limit(limit)
                .map(homework -> submissionRow(homework, latestLesson))
                .toList();

        List<Homework> afterLatestLesson = latestLesson == null
                ? List.of()
                : submitted.stream()
                        .filter(homework -> !homework.getSubmittedAt().isBefore(latestLesson.endsAt()))
                        .toList();
        List<Map<String, Object>> afterLatestLessonRows = afterLatestLesson.stream()
                .limit(limit)
                .map(homework -> submissionRow(homework, latestLesson))
                .toList();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", studentIdentity(student));
        result.put("timezone", SCHOOL_ZONE.getId());
        result.put("limit", limit);
        result.put("latestCompletedLesson", lessonRow(latestLesson));
        result.put("lessonContextAvailable", latestLesson != null);
        result.put("submittedAfterLatestLessonCount", afterLatestLesson.size());
        result.put("submittedAfterLatestLesson", afterLatestLessonRows);
        result.put("recentSubmissions", recent);
        result.put("latestHomeworkDefinition",
                "When latestCompletedLesson is available, 'latest homework' means the first item in submittedAfterLatestLesson. "
                        + "If that list is empty, no PDF homework has been submitted after the latest completed lesson. "
                        + "recentSubmissions is a fallback chronological view, newest first.");
        result.put("source", "mindcrafti_database");
        return result;
    }

    /** Download the actual submitted PDF stored by Mindcrafti, without going through Google Drive. */
    @Transactional(readOnly = true)
    public Map<String, Object> submissionPdf(
            User actor, boolean adminLike, UUID homeworkId) {
        Homework homework = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new IllegalArgumentException("Homework not found"));
        User student = requireAccessibleStudent(actor, adminLike, homework.getStudent().getId());
        if (!homework.isSubmitted() || homework.getSubmittedPdf() == null || homework.getSubmittedPdf().length == 0) {
            throw new IllegalArgumentException("This homework does not have a submitted PDF");
        }
        byte[] pdf = homework.getSubmittedPdf();
        if (pdf.length > MAX_DIRECT_PDF_BYTES) {
            throw new IllegalArgumentException("Submitted PDF exceeds the 15 MB MCP download limit");
        }

        String filename = homework.getSubmittedFilename();
        if (filename == null || filename.isBlank()) filename = "homework-submission.pdf";

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("homeworkId", homework.getId().toString());
        result.put("student", studentIdentity(student));
        result.put("assignedDate", homework.getStartDate().toString());
        result.put("submittedAt", homework.getSubmittedAt().toString());
        result.put("submittedAtSchoolTime", homework.getSubmittedAt().atZone(SCHOOL_ZONE).toString());
        result.put("filename", filename);
        result.put("mimeType", "application/pdf");
        result.put("sizeBytes", pdf.length);
        result.put("base64", Base64.getEncoder().encodeToString(pdf));
        result.put("source", "mindcrafti_database");
        return result;
    }

    private GroupLessonResponse latestCompletedLesson(User student) {
        User teacher = student.getTeacher();
        if (teacher == null || teacher.isArchived()
                || teacher.getGoogleCalendarRefreshToken() == null
                || teacher.getGoogleCalendarRefreshToken().isBlank()) {
            return null;
        }

        List<GroupLessonResponse> lessons;
        try {
            lessons = calendarLessonService.listGroupLessons(
                    new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole()));
        } catch (RuntimeException ignored) {
            return null;
        }

        Instant now = Instant.now();
        return lessons.stream()
                .filter(lesson -> lesson.endsAt() != null && !lesson.endsAt().isAfter(now))
                .filter(lesson -> belongsToStudent(lesson, student.getId()))
                .max(Comparator.comparing(GroupLessonResponse::endsAt))
                .orElse(null);
    }

    private boolean belongsToStudent(GroupLessonResponse lesson, UUID studentId) {
        if (studentId.equals(lesson.studentId())) return true;
        return lesson.groupId() != null
                && groupMemberRepository.existsByGroupIdAndStudentId(lesson.groupId(), studentId);
    }

    private Map<String, Object> submissionRow(Homework homework, GroupLessonResponse latestLesson) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("homeworkId", homework.getId().toString());
        row.put("assignedDate", homework.getStartDate().toString());
        row.put("worksheetFilename", homework.getWorksheetFilename());
        row.put("submittedFilename", homework.getSubmittedFilename());
        row.put("submittedAt", homework.getSubmittedAt().toString());
        row.put("submittedAtSchoolTime", homework.getSubmittedAt().atZone(SCHOOL_ZONE).toString());
        row.put("submittedAfterLatestLesson", latestLesson != null
                && !homework.getSubmittedAt().isBefore(latestLesson.endsAt()));
        row.put("teacherSitePath", "/teacher/students/" + homework.getStudent().getId()
                + "/homeworks/" + homework.getId());
        row.put("submissionApiPath", "/api/v1/homeworks/" + homework.getId() + "/submission");
        row.put("mcpDownloadTool", "download_homework_submission_pdf");
        return row;
    }

    private Map<String, Object> lessonRow(GroupLessonResponse lesson) {
        if (lesson == null) return null;
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("eventId", lesson.eventId());
        row.put("title", lesson.title());
        row.put("groupId", lesson.groupId() == null ? null : lesson.groupId().toString());
        row.put("groupName", lesson.groupName());
        row.put("studentId", lesson.studentId() == null ? null : lesson.studentId().toString());
        row.put("studentName", lesson.studentName());
        row.put("startsAt", lesson.startsAt() == null ? null : lesson.startsAt().toString());
        row.put("startsAtSchoolTime", lesson.startsAt() == null ? null : lesson.startsAt().atZone(SCHOOL_ZONE).toString());
        row.put("endsAt", lesson.endsAt() == null ? null : lesson.endsAt().toString());
        row.put("endsAtSchoolTime", lesson.endsAt() == null ? null : lesson.endsAt().atZone(SCHOOL_ZONE).toString());
        return row;
    }

    private Map<String, Object> studentIdentity(User student) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("studentId", student.getId().toString());
        row.put("studentName", student.getFullName());
        User teacher = student.getTeacher();
        row.put("teacherId", teacher == null ? null : teacher.getId().toString());
        row.put("teacherName", teacher == null ? null : teacher.getFullName());
        return row;
    }

    private User requireAccessibleStudent(User actor, boolean adminLike, UUID studentId) {
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new IllegalArgumentException("Student not found"));
        if (adminLike || (actor != null && actor.getRole() == Role.ADMIN)) return student;
        if (actor == null || actor.getRole() != Role.TEACHER || student.getTeacher() == null
                || !actor.getId().equals(student.getTeacher().getId())) {
            throw new IllegalArgumentException("Teachers can access only their own students");
        }
        return student;
    }
}
