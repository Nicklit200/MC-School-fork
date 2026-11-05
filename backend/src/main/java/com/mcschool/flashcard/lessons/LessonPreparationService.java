package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.UserRepository;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.io.RandomAccessReadBuffer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LessonPreparationService {
    private static final String ANSWERS_COMPAT_PREFIX = "__answers__:";
    private static final String ANSWERS_UPLOAD_HINT = "Prefer prepare_lesson with answersFile for a PDF created or attached in ChatGPT. Do NOT upload to Google Drive as an intermediate step. Legacy answersBase64 and driveAnswersFileId remain supported; use Drive only when the source already lives there. Refresh the MCH3 connection if the file fields are missing.";

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

    @Transactional(readOnly = true)
    public LessonPreparationResponse read(AuthenticatedUser teacher, String eventId) {
        return response(require(teacher, eventId));
    }

    public record AnswersMetadata(boolean hasAnswers, String answersFilename, long version) {}

    /** Polling must not create preparation rows or load private lesson content. */
    @Transactional(readOnly = true)
    public AnswersMetadata answersMetadata(AuthenticatedUser teacher, String eventId) {
        return repository.answersMetadata(teacher.id(), eventId)
                .filter(LessonPreparationRepository.AnswersMetadata::getHasAnswers)
                .map(row -> new AnswersMetadata(true, row.getAnswersFilename(), row.getVersion()))
                .orElseGet(() -> new AnswersMetadata(false, null, 0L));
    }

    @Transactional
    public LessonPreparationResponse update(AuthenticatedUser teacher, String eventId, UpdateLessonPreparationRequest request) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        preparation.updateNotes(request.homeworkNotes(), request.difficulties(), request.lessonPlan(), request.transcriptText());
        if (request.coveredMaterial() != null) {
            preparation.updateCoveredMaterial(request.coveredMaterial());
        }
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
        LessonPdfUpload.validate(pdf);
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        // Never guess a document's role from incidental words in its filename.
        // 'solutions_for_students.pdf' is still a workbook when the caller
        // chooses the workbook slot. An explicit __answers__: legacy prefix
        // is the ONLY backwards-compatible exception for older MCP clients.
        boolean answersCompatibility = isAnswersCompatibilityFilename(filename);
        String storedFilename = LessonPdfUpload.filename(
                answersCompatibility ? cleanAnswersFilename(filename) : filename,
                answersCompatibility ? "lesson-answers.pdf" : "lesson-workbook.pdf");
        if (answersCompatibility) {
            preparation.attachAnswers(storedFilename, pdf);
        } else {
            preparation.attachWorkbook(storedFilename, pdf);
        }
        LessonPreparation saved = repository.saveAndFlush(preparation);
        // Live classroom uploads must respond immediately after database persistence.
        // Drive archiving is available separately via the explicit archive endpoint;
        // do not block the upload HTTP request on remote Drive calls.
        return response(saved);
    }

    /**
     * Appends pages to the existing workbook without changing any old page
     * indices. Annotation operations are keyed by (document, pageIndex), so
     * the ink on already-used pages stays exactly where it was.
     * Each upload is atomic: corrupt PDFs cannot overwrite the previous file.
     */
    @Transactional
    public LessonPreparationResponse appendWorkbook(AuthenticatedUser teacher, String eventId,
                                                     String filename, byte[] pdf) {
        if (!looksLikePdf(pdf)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Please upload a valid PDF");
        }
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        byte[] merged;
        try {
            // Parse both files before merging: a PDF header alone does not
            // mean it is safe or even readable by the PDF viewer.
            try (var appended = Loader.loadPDF(pdf)) {
                if (appended.getNumberOfPages() == 0) {
                    throw new IOException("PDF contains no pages");
                }
            }
            if (!preparation.hasWorkbook()) {
                merged = pdf;
            } else {
                byte[] old = preparation.getWorkbookPdf();
                try (var existing = Loader.loadPDF(old)) {
                    if (existing.getNumberOfPages() == 0) throw new IOException("Existing PDF has no pages");
                }
                PDFMergerUtility merger = new PDFMergerUtility();
                merger.addSource(new RandomAccessReadBuffer(old));
                merger.addSource(new RandomAccessReadBuffer(pdf));
                try (var output = new ByteArrayOutputStream()) {
                    merger.setDestinationStream(output);
                    merger.mergeDocuments(IOUtils.createMemoryOnlyStreamCache());
                    merged = output.toByteArray();
                }
            }
            // Both server and browsers have bounded resources. Do not store
            // a huge combined file that would crash a student's tablet.
            if (merged.length > 25 * 1024 * 1024) {
                throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                        "Combined workbook exceeds 25 MB. Please use smaller PDFs.");
            }
        } catch (ResponseStatusException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "PDF could not be read or combined; previous workbook is unchanged", e);
        }
        String storedFilename = preparation.hasWorkbook()
                ? "lesson-workbook-combined.pdf"
                : (filename == null || filename.isBlank() ? "lesson-workbook.pdf" : filename);
        preparation.attachWorkbook(storedFilename, merged);
        return response(repository.saveAndFlush(preparation));
    }

    @Transactional
    public LessonPreparationResponse uploadAnswers(AuthenticatedUser teacher, String eventId, String filename, byte[] pdf) {
        LessonPdfUpload.validate(pdf);
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        preparation.attachAnswers(LessonPdfUpload.filename(filename, "lesson-answers.pdf"), pdf);
        LessonPreparation saved = repository.saveAndFlush(preparation);
        return response(saved);
    }

    /**
     * Save an explicitly selected pair of materials as one local transaction.
     * All files are validated before touching the existing preparation; omitted
     * document slots and note fields are preserved. Drive archiving is explicit.
     */
    @Transactional
    public LessonPreparationResponse prepareMaterials(AuthenticatedUser teacher, String eventId,
            UpdateLessonPreparationRequest notes, String workbookFilename, byte[] workbookPdf,
            String answersFilename, byte[] answersPdf) {
        if (workbookPdf != null) LessonPdfUpload.validate(workbookPdf);
        if (answersPdf != null) LessonPdfUpload.validate(answersPdf);
        boolean legacyAnswers = workbookPdf != null && isAnswersCompatibilityFilename(workbookFilename);
        if (legacyAnswers && answersPdf != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "exactly_one_source_required: use one source for the answers slot");
        }
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        if (notes != null) {
            preparation.updateNotes(
                    notes.homeworkNotes() == null ? preparation.getHomeworkNotes() : notes.homeworkNotes(),
                    notes.difficulties() == null ? preparation.getDifficulties() : notes.difficulties(),
                    notes.lessonPlan() == null ? preparation.getLessonPlan() : notes.lessonPlan(),
                    notes.transcriptText() == null ? preparation.getTranscriptText() : notes.transcriptText());
            if (notes.coveredMaterial() != null) preparation.updateCoveredMaterial(notes.coveredMaterial());
        }
        if (workbookPdf != null) {
            String filename = LessonPdfUpload.filename(
                    legacyAnswers ? cleanAnswersFilename(workbookFilename) : workbookFilename,
                    legacyAnswers ? "lesson-answers.pdf" : "lesson-workbook.pdf");
            if (legacyAnswers) preparation.attachAnswers(filename, workbookPdf);
            else preparation.attachWorkbook(filename, workbookPdf);
        }
        if (answersPdf != null) {
            preparation.attachAnswers(LessonPdfUpload.filename(answersFilename, "lesson-answers.pdf"), answersPdf);
        }
        return response(repository.saveAndFlush(preparation));
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
        String legacy = preparation.getTranscriptTextForDisplay();
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
                    userRepository.findById(teacher.id())
                            .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
                    // A deferred JPA insert races when different pupils receive
                    // their first PDFs together. Let PostgreSQL create one row,
                    // wait for the winning transaction, then load its managed
                    // entity. Catching a duplicate key would abort this transaction.
                    repository.insertIfAbsent(teacher.id(), eventId);
                    return repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                            .orElseThrow(() -> new ResourceNotFoundException("Lesson preparation not found"));
                });
    }

    private boolean isAnswersCompatibilityFilename(String filename) {
        if (filename == null || filename.isBlank()) return false;
        String normalized = filename.trim().toLowerCase(Locale.ROOT);
        if (normalized.startsWith(ANSWERS_COMPAT_PREFIX)) return true;
        return false;
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
                preparation.hasTranscriptPdf() ? null : preparation.getTranscriptTextForDisplay(),
                preparation.hasTranscript(),
                preparation.getTranscriptFilename(),
                preparation.hasWorkbook(),
                preparation.getWorkbookFilename(),
                preparation.hasAnswers(),
                preparation.getAnswersFilename(),
                preparation.hasAnswers() ? null : ANSWERS_UPLOAD_HINT,
                preparation.getSiteOpenedAt(),
                preparation.getCoveredMaterial(),
                preparation.getTranscriptText(),
                preparation.getSonioxTranscriptText(),
                true,
                preparation.hasWorkbook() ? preparation.getWorkbookPdf().length : 0,
                preparation.getWorkbookVersion(),
                preparation.hasAnswers() ? preparation.getAnswersPdf().length : 0,
                preparation.getAnswersVersion());
    }
}
