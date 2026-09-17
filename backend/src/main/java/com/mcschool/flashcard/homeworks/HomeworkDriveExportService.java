package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.drive.GoogleDriveStructureService;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.users.User;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HomeworkDriveExportService {

    private static final Logger log = LoggerFactory.getLogger(HomeworkDriveExportService.class);
    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    private static final DateTimeFormatter EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");

    private final HomeworkRepository homeworkRepository;
    private final GoogleDriveService googleDriveService;
    private final GoogleDriveStructureService googleDriveStructureService;
    private final StudentGroupMemberRepository groupMemberRepository;

    // Kept for tests/direct construction. Spring uses the annotated constructor below.
    public HomeworkDriveExportService(HomeworkRepository homeworkRepository,
                                      GoogleDriveService googleDriveService) {
        this(homeworkRepository, googleDriveService, null, null);
    }

    @Autowired
    public HomeworkDriveExportService(HomeworkRepository homeworkRepository,
                                      GoogleDriveService googleDriveService,
                                      GoogleDriveStructureService googleDriveStructureService,
                                      StudentGroupMemberRepository groupMemberRepository) {
        this.homeworkRepository = homeworkRepository;
        this.googleDriveService = googleDriveService;
        this.googleDriveStructureService = googleDriveStructureService;
        this.groupMemberRepository = groupMemberRepository;
    }

    /**
     * Best-effort background export. The student's submission response must not
     * wait for Google Drive, especially on mobile networks. The homework is already
     * committed before this asynchronous method loads it and starts the Drive upload.
     *
     * <p>Normally the destination is stored automatically when the student is created
     * or added to a group. If an older student has no stored destination, repair it
     * here before uploading. A manually configured non-empty destination is always
     * respected and is never replaced by this fallback.</p>
     */
    @Async
    @Transactional
    public void exportSubmittedHomework(UUID studentId, UUID homeworkId) {
        Homework homework = homeworkRepository.findByIdAndStudentId(homeworkId, studentId).orElse(null);
        if (homework == null || !homework.isSubmitted()) {
            return;
        }

        User student = homework.getStudent();
        String folderId = ensureHomeworkFolder(student);
        if (folderId == null || folderId.isBlank()) {
            log.info("Skipping submitted homework Drive export because no homework folder could be resolved: studentId={} homeworkId={}",
                    studentId, homeworkId);
            return;
        }

        try {
            String sourceName = homework.getSubmittedFilename();
            if (sourceName == null || sourceName.isBlank()) {
                sourceName = "homework-submitted.pdf";
            }
            String baseName = sourceName.replaceFirst("(?i)\\.pdf$", "");
            String timestamp = homework.getSubmittedAt()
                    .atZone(SCHOOL_ZONE)
                    .format(EXPORT_TIME);
            String fileName = safeFileName(student.getFullName()) + "_"
                    + timestamp + "_" + safeFileName(baseName) + ".pdf";

            googleDriveService.uploadBytes(folderId, fileName, "application/pdf", homework.getSubmittedPdf());
            log.info("Uploaded submitted homework to Google Drive: studentId={} homeworkId={} folderId={} file={}",
                    studentId, homeworkId, folderId, fileName);
        } catch (Exception ex) {
            log.error("Could not export submitted homework to Google Drive: studentId={} homeworkId={}",
                    studentId, homeworkId, ex);
        }
    }

    private String ensureHomeworkFolder(User student) {
        String configured = student.getGoogleDriveHomeworkFolderId();
        if (configured != null && !configured.isBlank()) {
            // This covers both the automatic destination and an explicit manual override.
            return configured;
        }
        if (googleDriveStructureService == null || student.getTeacher() == null) {
            return null;
        }

        if (groupMemberRepository != null) {
            List<StudentGroupMember> memberships = groupMemberRepository
                    .findAllByStudentIdOrderByCreatedAtAsc(student.getId());
            if (memberships.size() == 1) {
                googleDriveStructureService.provisionGroupMember(
                        student.getTeacher(), memberships.get(0).getGroup(), student);
                return student.getGoogleDriveHomeworkFolderId();
            }
            if (memberships.size() > 1) {
                // Homework does not currently carry a group id, so choosing one group here
                // would risk sending a file to the wrong place. The manual picker remains
                // available for this uncommon ambiguous case.
                log.warn("Cannot auto-resolve homework Drive folder because student belongs to multiple groups: studentId={} groups={}",
                        student.getId(), memberships.size());
                return null;
            }
        }

        googleDriveStructureService.provisionIndividualStudent(student.getTeacher(), student);
        return student.getGoogleDriveHomeworkFolderId();
    }

    private String safeFileName(String value) {
        if (value == null || value.isBlank()) {
            return "homework";
        }
        String cleaned = value.trim().replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\s+", "_");
        return cleaned.isBlank() ? "homework" : cleaned;
    }
}
