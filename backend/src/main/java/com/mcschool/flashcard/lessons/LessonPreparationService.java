package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LessonPreparationService {
    private static final String ANSWERS_COMPAT_PREFIX = "__answers__:";
    private static final String ANSWERS_UPLOAD_HINT = "If your Mindcrafti tool schema does not expose a separate answers field, call prepare_lesson with driveWorkbookFileId set to the answers PDF and workbookFilename beginning with '__answers__:'; the server will store it in the dedicated Answers slot and preserve the workbook.";

    private final LessonPreparationRepository repository;
    private final UserRepository userRepository;
    private final LessonDriveArchiveService driveArchiveService;

    public LessonPreparationService(
            LessonPreparationRepository repository,
            UserRepository userRepository,
            LessonDriveArchiveService driveArchiveService) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.driveArchiveService = driveArchiveService;
    }

    @Transactional
    public LessonPreparationResponse getOrCreate(AuthenticatedUser teacher, String eventId) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        return response(repository.save(preparation));
    }

    @Transactional
    public LessonPreparationResponse update(AuthenticatedUser teacher, String eventId, UpdateLessonPreparationRequest request) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        preparation.updateNotes(request.homeworkNotes(), request.difficulties(), request.lessonPlan(), request.transcriptText());
        return response(repository.save(preparation));
    }

    @Transactional
    public LessonPreparationResponse markSiteOpened(AuthenticatedUser teacher, String eventId) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        preparation.markSiteOpened(Instant.now());
        return response(repository.save(preparation));
    }

    @Transactional
    public LessonPreparationResponse uploadWorkbook(AuthenticatedUser teacher, String eventId, String filename, byte[] pdf) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        boolean answersCompatibility = isAnswersCompatibilityFilename(filename);
        String storedFilename = answersCompatibility ? cleanAnswersFilename(filename) : filename;
        if (answersCompatibility) {
            preparation.attachAnswers(storedFilename, pdf);
        } else {
            preparation.attachWorkbook(storedFilename, pdf);
        }
        LessonPreparation saved = repository.save(preparation);
        if (answersCompatibility) {
            driveArchiveService.archiveAnswersBestEffort(teacher, eventId, storedFilename, pdf);
        } else {
            driveArchiveService.archiveWorkbookBestEffort(teacher, eventId, storedFilename, pdf);
        }
        return response(saved);
    }

    @Transactional
    public LessonPreparationResponse uploadAnswers(AuthenticatedUser teacher, String eventId, String filename, byte[] pdf) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        preparation.attachAnswers(filename, pdf);
        LessonPreparation saved = repository.save(preparation);
        driveArchiveService.archiveAnswersBestEffort(teacher, eventId, filename, pdf);
        return response(saved);
    }

    @Transactional
    public LessonPreparationResponse uploadTranscript(
            AuthenticatedUser teacher, String eventId, String filename, byte[] pdf) throws Exception {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        String storedFilename = filename == null || filename.isBlank() ? "lesson-transcript.pdf" : filename.trim();
        if (!storedFilename.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            throw new IllegalArgumentException("Transcript file must be PDF");
        }
        if (!looksLikePdf(pdf)) {
            throw new IllegalArgumentException("Transcript file does not contain a valid PDF");
        }

        // Validate once at upload time so unreadable/corrupt PDFs never become the lesson source.
        try (var document = Loader.loadPDF(pdf)) {
            String extracted = new PDFTextStripper().getText(document);
            if (extracted == null || extracted.isBlank()) {
                throw new IllegalArgumentException("Transcript PDF does not contain readable text");
            }
        }

        preparation.attachTranscriptPdf(storedFilename, pdf);
        return response(repository.save(preparation));
    }

    @Transactional(readOnly = true)
    public String transcriptTextForAnalysis(AuthenticatedUser teacher, String eventId) {
        return transcriptTextForAnalysis(require(teacher, eventId));
    }

    public String transcriptTextForAnalysis(LessonPreparation preparation) {
        if (preparation.hasTranscriptPdf()) {
            try (var document = Loader.loadPDF(preparation.getTranscriptPdf())) {
                String extracted = new PDFTextStripper().getText(document);
                return extracted == null ? "" : extracted.trim();
            } catch (Exception ex) {
                throw new IllegalArgumentException("Stored transcript PDF could not be read", ex);
            }
        }
        String legacy = preparation.getTranscriptText();
        return legacy == null ? "" : legacy.trim();
    }

    @Transactional(readOnly = true)
    public LessonPreparationResponse archiveToDrive(AuthenticatedUser teacher, String eventId) {
        LessonPreparation preparation = require(teacher, eventId);
        if (preparation.hasWorkbook()) {
            driveArchiveService.archiveWorkbook(
                    teacher, eventId, preparation.getWorkbookFilename(), preparation.getWorkbookPdf());
        }
        if (preparation.hasAnswers()) {
            driveArchiveService.archiveAnswers(
                    teacher, eventId, preparation.getAnswersFilename(), preparation.getAnswersPdf());
        }
        return response(preparation);
    }

    @Transactional(readOnly = true)
    public LessonPreparation require(AuthenticatedUser teacher, String eventId) {
        return repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson preparation not found"));
    }

    private LessonPreparation getOrCreateEntity(AuthenticatedUser teacher, String eventId) {
        return repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseGet(() -> {
                    User teacherEntity = userRepository.findById(teacher.id())
                            .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
                    return LessonPreparation.create(teacherEntity, eventId);
                });
    }

    private boolean isAnswersCompatibilityFilename(String filename) {
        if (filename == null || filename.isBlank()) return false;
        String normalized = filename.trim().toLowerCase(Locale.ROOT);
        if (normalized.startsWith(ANSWERS_COMPAT_PREFIX)) return true;
        return normalized.contains("answer")
                || normalized.contains("solution")
                || normalized.contains("ответ")
                || normalized.contains("решен");
    }

    private String cleanAnswersFilename(String filename) {
        if (filename == null || filename.isBlank()) return "lesson-answers.pdf";
        String cleaned = filename.trim();
        if (cleaned.toLowerCase(Locale.ROOT).startsWith(ANSWERS_COMPAT_PREFIX)) {
            cleaned = cleaned.substring(ANSWERS_COMPAT_PREFIX.length()).trim();
        }
        if (cleaned.isBlank()) cleaned = "lesson-answers.pdf";
        if (!cleaned.toLowerCase(Locale.ROOT).endsWith(".pdf")) cleaned += ".pdf";
        return cleaned;
    }

    private boolean looksLikePdf(byte[] bytes) {
        return bytes != null && bytes.length >= 5
                && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F' && bytes[4] == '-';
    }

    private LessonPreparationResponse response(LessonPreparation preparation) {
        return new LessonPreparationResponse(
                preparation.getEventId(),
                preparation.getHomeworkNotes(),
                preparation.getDifficulties(),
                preparation.getLessonPlan(),
                preparation.hasTranscriptPdf() ? null : preparation.getTranscriptText(),
                preparation.hasTranscript(),
                preparation.getTranscriptFilename(),
                preparation.hasWorkbook(),
                preparation.getWorkbookFilename(),
                preparation.hasAnswers(),
                preparation.getAnswersFilename(),
                preparation.hasAnswers() ? null : ANSWERS_UPLOAD_HINT,
                preparation.getSiteOpenedAt());
    }
}
