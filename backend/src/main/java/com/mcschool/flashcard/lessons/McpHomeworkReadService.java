package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkDeadlinePolicy;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.notifications.AppLinks;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only access to submitted PDF homework for the Mindcrafti MCP connector. */
@Service
public class McpHomeworkReadService {

    private static final ZoneId SCHOOL_ZONE = HomeworkDeadlinePolicy.SCHOOL_ZONE;
    private static final int MAX_RECENT_SUBMISSIONS = 10;
    private static final int MAX_DIRECT_PDF_BYTES = 15 * 1024 * 1024;
    private static final int MAX_HOMEWORK_RANGE_DAYS = 366;
    private static final int MAX_SUBMISSION_PAGE_BATCH = 8;
    private static final float PAGE_RENDER_DPI = 144f;

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final GoogleCalendarLessonService calendarLessonService;
    private final AppLinks appLinks;

    public McpHomeworkReadService(
            UserRepository userRepository,
            HomeworkRepository homeworkRepository,
            StudentGroupMemberRepository groupMemberRepository,
            GoogleCalendarLessonService calendarLessonService,
            AppLinks appLinks) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.calendarLessonService = calendarLessonService;
        this.appLinks = appLinks;
    }

    /**
     * Returns every homework bucket assigned to one student inside an inclusive date range.
     * This is intentionally independent of Google Drive: the database is the source of truth.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> findStudentHomeworks(
            User actor, boolean adminLike, UUID studentId, LocalDate fromDate, LocalDate toDate) {
        if (fromDate == null || toDate == null) {
            throw new IllegalArgumentException("fromDate and toDate are required");
        }
        if (toDate.isBefore(fromDate)) {
            throw new IllegalArgumentException("toDate must be on or after fromDate");
        }
        long inclusiveDays = ChronoUnit.DAYS.between(fromDate, toDate) + 1;
        if (inclusiveDays > MAX_HOMEWORK_RANGE_DAYS) {
            throw new IllegalArgumentException("Homework date range cannot exceed " + MAX_HOMEWORK_RANGE_DAYS + " days");
        }

        User student = requireAccessibleStudent(actor, adminLike, studentId);
        List<Homework> homeworks = homeworkRepository
                .findAllByStudentIdOrderByStartDateDescCreatedAtDesc(studentId).stream()
                .filter(homework -> !homework.getStartDate().isBefore(fromDate))
                .filter(homework -> !homework.getStartDate().isAfter(toDate))
                .toList();

        List<Map<String, Object>> rows = homeworks.stream()
                .map(this::homeworkRow)
                .toList();
        long submittedCount = homeworks.stream().filter(Homework::isSubmitted).count();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", studentIdentity(student));
        result.put("timezone", SCHOOL_ZONE.getId());
        result.put("fromDate", fromDate.toString());
        result.put("toDate", toDate.toString());
        result.put("homeworkCount", homeworks.size());
        result.put("submittedCount", submittedCount);
        result.put("homeworks", rows);
        result.put("source", "mindcrafti_database");
        return result;
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
        Homework homework = requireSubmittedHomework(actor, adminLike, homeworkId);
        User student = homework.getStudent();
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
        result.put("teacherSiteUrl", appLinks.teacherHomeworkLink(student.getId(), homework.getId()));
        result.put("source", "mindcrafti_database");
        return result;
    }

    /**
     * Render pages from the student's actual submitted PDF as PNG images.
     * Page numbers are 1-based for MCP callers. At most eight pages are returned per call.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> submissionPages(
            User actor, boolean adminLike, UUID homeworkId, int startPage, int pageCount) {
        if (startPage < 1) throw new IllegalArgumentException("startPage must be at least 1");
        if (pageCount < 1 || pageCount > MAX_SUBMISSION_PAGE_BATCH) {
            throw new IllegalArgumentException("pageCount must be between 1 and " + MAX_SUBMISSION_PAGE_BATCH);
        }

        Homework homework = requireSubmittedHomework(actor, adminLike, homeworkId);
        User student = homework.getStudent();
        byte[] pdf = homework.getSubmittedPdf();

        try (PDDocument document = Loader.loadPDF(pdf)) {
            int totalPageCount = document.getNumberOfPages();
            if (startPage > totalPageCount) {
                throw new IllegalArgumentException("startPage exceeds the submitted PDF page count");
            }
            int endPage = Math.min(totalPageCount, startPage + pageCount - 1);
            PDFRenderer renderer = new PDFRenderer(document);
            List<Map<String, Object>> pages = new java.util.ArrayList<>();

            for (int pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
                BufferedImage image = renderer.renderImageWithDPI(pageNumber - 1, PAGE_RENDER_DPI, ImageType.RGB);
                try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    ImageIO.write(image, "png", out);
                    byte[] png = out.toByteArray();
                    Map<String, Object> page = new LinkedHashMap<>();
                    page.put("pageNumber", pageNumber);
                    page.put("pageIndex", pageNumber - 1);
                    page.put("mimeType", "image/png");
                    page.put("widthPx", image.getWidth());
                    page.put("heightPx", image.getHeight());
                    page.put("sizeBytes", png.length);
                    page.put("base64", Base64.getEncoder().encodeToString(png));
                    pages.add(page);
                }
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("homeworkId", homework.getId().toString());
            result.put("student", studentIdentity(student));
            result.put("assignedDate", homework.getStartDate().toString());
            result.put("submittedAt", homework.getSubmittedAt().toString());
            result.put("submittedAtSchoolTime", homework.getSubmittedAt().atZone(SCHOOL_ZONE).toString());
            result.put("filename", homework.getSubmittedFilename());
            result.put("totalPageCount", totalPageCount);
            result.put("startPage", startPage);
            result.put("renderedPageCount", pages.size());
            result.put("nextStartPage", endPage < totalPageCount ? endPage + 1 : null);
            result.put("pages", pages);
            result.put("teacherSiteUrl", appLinks.teacherHomeworkLink(student.getId(), homework.getId()));
            result.put("source", "mindcrafti_database");
            return result;
        } catch (IOException ex) {
            throw new IllegalStateException("Could not render submitted homework PDF", ex);
        }
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

    private Map<String, Object> homeworkRow(Homework homework) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("homeworkId", homework.getId().toString());
        row.put("assignedDate", homework.getStartDate().toString());
        row.put("worksheetFilename", homework.getWorksheetFilename());
        row.put("hasWorksheet", homework.hasWorksheet());
        row.put("submitted", homework.isSubmitted());
        row.put("submittedFilename", homework.getSubmittedFilename());
        row.put("submittedAt", homework.getSubmittedAt() == null ? null : homework.getSubmittedAt().toString());
        row.put("submittedAtSchoolTime", homework.getSubmittedAt() == null
                ? null : homework.getSubmittedAt().atZone(SCHOOL_ZONE).toString());
        row.put("submissionSizeBytes", homework.getSubmittedPdf() == null ? null : homework.getSubmittedPdf().length);
        row.put("teacherSiteUrl", appLinks.teacherHomeworkLink(homework.getStudent().getId(), homework.getId()));
        row.put("submissionApiPath", homework.isSubmitted()
                ? "/api/v1/homeworks/" + homework.getId() + "/submission" : null);
        row.put("mcpSubmissionTool", homework.isSubmitted() ? "get_homework_submission" : null);
        row.put("mcpPagesTool", homework.isSubmitted() ? "get_homework_submission_pages" : null);
        return row;
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
        row.put("teacherSiteUrl", appLinks.teacherHomeworkLink(homework.getStudent().getId(), homework.getId()));
        row.put("submissionApiPath", "/api/v1/homeworks/" + homework.getId() + "/submission");
        row.put("mcpSubmissionTool", "get_homework_submission");
        row.put("mcpPagesTool", "get_homework_submission_pages");
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

    private Homework requireSubmittedHomework(User actor, boolean adminLike, UUID homeworkId) {
        Homework homework = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new IllegalArgumentException("Homework not found"));
        requireAccessibleStudent(actor, adminLike, homework.getStudent().getId());
        if (!homework.isSubmitted() || homework.getSubmittedPdf() == null || homework.getSubmittedPdf().length == 0) {
            throw new IllegalArgumentException("This homework does not have a submitted PDF");
        }
        return homework;
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
