package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.drive.GoogleDriveStructureService;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Mirrors lesson PDFs from Mindcrafti's primary database storage into the school
 * Google Drive. Drive is deliberately best-effort: a Drive outage or permission
 * problem must never make the lesson PDF disappear from Mindcrafti.
 */
@Service
public class LessonDriveArchiveService {

    private static final Logger log = LoggerFactory.getLogger(LessonDriveArchiveService.class);

    private final UserRepository userRepository;
    private final StudentGroupRepository groupRepository;
    private final GoogleCalendarLessonService calendarLessonService;
    private final GoogleDriveStructureService driveStructureService;
    private final GoogleDriveService googleDriveService;

    public LessonDriveArchiveService(
            UserRepository userRepository,
            StudentGroupRepository groupRepository,
            GoogleCalendarLessonService calendarLessonService,
            GoogleDriveStructureService driveStructureService,
            GoogleDriveService googleDriveService) {
        this.userRepository = userRepository;
        this.groupRepository = groupRepository;
        this.calendarLessonService = calendarLessonService;
        this.driveStructureService = driveStructureService;
        this.googleDriveService = googleDriveService;
    }

    public void archiveWorkbookBestEffort(
            AuthenticatedUser teacher,
            String eventId,
            String filename,
            byte[] pdf) {
        archiveBestEffort(teacher, eventId, filename, pdf, "lesson-workbook.pdf", "workbook");
    }

    public void archiveAnswersBestEffort(
            AuthenticatedUser teacher,
            String eventId,
            String filename,
            byte[] pdf) {
        archiveBestEffort(teacher, eventId, filename, pdf, "lesson-answers.pdf", "answers");
    }

    private void archiveBestEffort(
            AuthenticatedUser teacher,
            String eventId,
            String filename,
            byte[] pdf,
            String fallbackFilename,
            String kind) {
        if (pdf == null || pdf.length == 0) return;
        try {
            ArchiveDestination destination = destination(teacher, eventId);
            String safeFilename = pdfFilename(filename, fallbackFilename);
            googleDriveService.upsertBytes(
                    destination.folderId(),
                    safeFilename,
                    "application/pdf",
                    pdf);
            log.info(
                    "Archived lesson {} to Google Drive: teacherId={}, eventId={}, destination={}, filename={}",
                    kind,
                    teacher.id(),
                    eventId,
                    destination.label(),
                    safeFilename);
        } catch (RuntimeException ex) {
            log.warn(
                    "Lesson {} saved in Mindcrafti but Google Drive archive failed: teacherId={}, eventId={}, reason={}",
                    kind,
                    teacher.id(),
                    eventId,
                    ex.getMessage());
        }
    }

    private ArchiveDestination destination(AuthenticatedUser teacher, String eventId) {
        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new IllegalStateException("Teacher account no longer exists"));

        GroupLessonResponse lesson = calendarLessonService.listGroupLessons(teacher).stream()
                .filter(candidate -> candidate.eventId().equals(eventId))
                .findFirst()
                .orElse(null);

        if (lesson != null && lesson.studentId() != null) {
            User student = requireStudent(lesson.studentId(), teacher.id());
            return new ArchiveDestination(
                    driveStructureService.resolveStudentDocumentFolder(teacherEntity, student, "clean"),
                    student.getFullName() + " / clean");
        }

        if (lesson != null && lesson.groupId() != null) {
            StudentGroup group = groupRepository.findByIdAndTeacherId(lesson.groupId(), teacher.id())
                    .orElseThrow(() -> new IllegalStateException("Lesson group no longer exists"));
            return new ArchiveDestination(
                    driveStructureService.resolveGroupDocumentFolder(teacherEntity, group, "clean"),
                    group.getName() + " / clean");
        }

        return new ArchiveDestination(
                driveStructureService.resolveTeacherTrialDocumentFolder(teacherEntity),
                "Пробные уроки");
    }

    private User requireStudent(UUID studentId, UUID teacherId) {
        return userRepository.findById(studentId)
                .filter(student -> !student.isArchived())
                .filter(student -> student.getTeacher() != null && teacherId.equals(student.getTeacher().getId()))
                .orElseThrow(() -> new IllegalStateException("Lesson student no longer exists"));
    }

    private String pdfFilename(String filename, String fallback) {
        String value = filename == null || filename.isBlank() ? fallback : filename.trim();
        if (!value.toLowerCase().endsWith(".pdf")) value += ".pdf";
        return value;
    }

    private record ArchiveDestination(String folderId, String label) {}
}
