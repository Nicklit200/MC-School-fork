package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
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
            AuthenticatedUser teacher, String eventId, String filename, byte[] fileBytes) throws Exception {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        String normalizedFilename = filename == null ? "" : filename.trim().toLowerCase(Locale.ROOT);
        String transcript;
        if (normalizedFilename.endsWith(".pdf")) {
            try (var document = Loader.loadPDF(fileBytes)) {
                transcript = new PDFTextStripper().getText(document);
            }
        } else if (normalizedFilename.endsWith(".txt")) {
            transcript = new String(fileBytes, StandardCharsets.UTF_8);
        } else {
            throw new IllegalArgumentException("Transcript file must be PDF or TXT");
        }
        if (transcript == null || transcript.isBlank()) {
            throw new IllegalArgumentException("Transcript file does not contain readable text");
        }
        preparation.attachTranscript(transcript);
        return response(repository.save(preparation));
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

    private LessonPreparationResponse response(LessonPreparation preparation) {
        return new LessonPreparationResponse(
                preparation.getEventId(),
                preparation.getHomeworkNotes(),
                preparation.getDifficulties(),
                preparation.getLessonPlan(),
                preparation.getTranscriptText(),
                preparation.hasWorkbook(),
                preparation.getWorkbookFilename(),
                preparation.hasAnswers(),
                preparation.getAnswersFilename(),
                preparation.hasAnswers() ? null : ANSWERS_UPLOAD_HINT,
                preparation.getSiteOpenedAt());
    }
}
