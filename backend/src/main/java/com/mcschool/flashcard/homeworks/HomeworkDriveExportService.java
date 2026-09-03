package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.drive.GoogleDriveService;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HomeworkDriveExportService {

    private static final Logger log = LoggerFactory.getLogger(HomeworkDriveExportService.class);
    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    private static final DateTimeFormatter EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");

    private final HomeworkRepository homeworkRepository;
    private final GoogleDriveService googleDriveService;

    public HomeworkDriveExportService(HomeworkRepository homeworkRepository,
                                      GoogleDriveService googleDriveService) {
        this.homeworkRepository = homeworkRepository;
        this.googleDriveService = googleDriveService;
    }

    /**
     * Best-effort export. The student's submission must remain successful even if
     * Google Drive is temporarily unavailable; the failure is logged explicitly.
     */
    @Transactional(readOnly = true)
    public void exportSubmittedHomework(UUID studentId, UUID homeworkId) {
        Homework homework = homeworkRepository.findByIdAndStudentId(homeworkId, studentId).orElse(null);
        if (homework == null || !homework.isSubmitted()) {
            return;
        }

        String folderId = homework.getStudent().getGoogleDriveHomeworkFolderId();
        if (folderId == null || folderId.isBlank()) {
            log.info("Skipping submitted homework Drive export because no homework folder is configured: studentId={} homeworkId={}",
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
            String fileName = safeFileName(homework.getStudent().getFullName()) + "_"
                    + timestamp + "_" + safeFileName(baseName) + ".pdf";

            googleDriveService.uploadBytes(folderId, fileName, "application/pdf", homework.getSubmittedPdf());
            log.info("Uploaded submitted homework to Google Drive: studentId={} homeworkId={} file={}",
                    studentId, homeworkId, fileName);
        } catch (Exception ex) {
            log.error("Could not export submitted homework to Google Drive: studentId={} homeworkId={}",
                    studentId, homeworkId, ex);
        }
    }

    private String safeFileName(String value) {
        if (value == null || value.isBlank()) {
            return "homework";
        }
        String cleaned = value.trim().replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\s+", "_");
        return cleaned.isBlank() ? "homework" : cleaned;
    }
}
