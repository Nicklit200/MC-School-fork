package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/**
 * Adds approved server-generated worksheets to a pupil's existing My Board
 * instead of hiding its older pages. The shared board and the original draft
 * remain unchanged; private teacher answers are extended separately.
 */
@Service
public class PersonalWorkbookDraftService {
    private static final int MAX_COMBINED_PAGES = 1000;
    private static final String DRAFT_IDS_METADATA = "MindcraftiAppendedDraftIds";
    private final McpAccessService access;
    private final McpOperationReceiptService receipts;
    private final LessonPdfDraftService drafts;
    private final PersonalLessonWorkbookService workbooks;
    private final PersonalLessonAnswersService answers;
    private final LessonPreparationRepository preparations;

    public PersonalWorkbookDraftService(McpAccessService access, McpOperationReceiptService receipts,
            LessonPdfDraftService drafts, PersonalLessonWorkbookService workbooks,
            PersonalLessonAnswersService answers, LessonPreparationRepository preparations) {
        this.access = access;
        this.receipts = receipts;
        this.drafts = drafts;
        this.workbooks = workbooks;
        this.answers = answers;
        this.preparations = preparations;
    }

    public Object publish(AuthenticatedUser actor, UUID teacherId, String eventId, UUID studentId,
            UUID draftId, String key, boolean confirm) {
        if (!confirm) throw new IllegalArgumentException("Review both PDFs and supply confirm=true only after the user's explicit upload instruction");
        AuthenticatedUser teacher = access.requireTeacher(actor, teacherId);
        Map<String, Object> normalized = Map.of("teacherId", teacher.id().toString(),
                "eventId", eventId, "studentId", studentId.toString(), "draftId", draftId.toString());
        // The durable operation receipt, both private PDFs and metadata updates
        // share one DB transaction. A failure cannot publish only the answers.
        return receipts.execute(actor, teacher.id(), "publish_personal_lesson_draft", key, normalized,
                () -> validate(actor, teacher.id(), eventId, studentId, draftId),
                () -> access.asTeacher(actor, teacher, () -> {
                    var workbook = drafts.previewFile(teacher, draftId, "workbook");
                    var solutions = drafts.previewFile(teacher, draftId, "answers");
                    var shared = preparations.findByTeacherIdAndEventId(teacher.id(), eventId).orElse(null);

                    // Before the pupil's first private upload, "My Board" used
                    // the shared workbook. Preserve those inherited pages by
                    // copying them into the private PDF BEFORE the new pages.
                    // This also repairs drafts published with the old replace-only
                    // behavior: if private bytes equal this exact draft, prepend
                    // the old shared material once without duplicating the draft.
                    byte[] personalWorkbook = workbooks.workbook(teacher, eventId, studentId).orElse(null);
                    byte[] personalAnswers = answers.answers(teacher, eventId, studentId).orElse(null);
                    byte[] sharedWorkbook = shared != null && shared.hasWorkbook() ? shared.getWorkbookPdf() : null;
                    byte[] sharedAnswers = shared != null && shared.hasAnswers() ? shared.getAnswersPdf() : null;
                    MergePdf mergedWorkbook = addPages(personalWorkbook, sharedWorkbook, workbook.bytes(), draftId);
                    MergePdf mergedAnswers = addPages(personalAnswers, sharedAnswers, solutions.bytes(), draftId);

                    if (!Arrays.equals(personalWorkbook, mergedWorkbook.bytes()))
                        workbooks.upload(teacher, eventId, studentId,
                                mergedWorkbook.combined() ? "Mindcrafti_Arbeitsheft_gesammelt.pdf" : workbook.filename(),
                                mergedWorkbook.bytes());
                    if (!Arrays.equals(personalAnswers, mergedAnswers.bytes()))
                        answers.upload(teacher, eventId, studentId,
                                mergedAnswers.combined() ? "Mindcrafti_Lehrerloesungen_gesammelt.pdf" : solutions.filename(),
                                mergedAnswers.bytes());

                    var saved = workbooks.list(teacher, eventId).students().stream()
                            .filter(s -> s.studentId().equals(studentId)).findFirst().orElseThrow();
                    if (!saved.hasWorkbook() || !saved.hasAnswers()
                            || saved.workbookSizeBytes() != mergedWorkbook.bytes().length
                            || saved.answersSizeBytes() != mergedAnswers.bytes().length)
                        throw new IllegalStateException("Personal PDF readback did not match the approved additive draft");
                    return Map.ofEntries(
                            Map.entry("published", true),
                            Map.entry("sourceDraftId", draftId.toString()),
                            Map.entry("teacherId", teacher.id().toString()),
                            Map.entry("eventId", eventId),
                            Map.entry("studentId", studentId.toString()),
                            Map.entry("workbookFilename", saved.filename()),
                            Map.entry("answersFilename", saved.answersFilename()),
                            Map.entry("workbookVersion", saved.version()),
                            Map.entry("answersVersion", saved.answersVersion()),
                            Map.entry("workbookPages", mergedWorkbook.pages()),
                            Map.entry("answersPages", mergedAnswers.pages()),
                            Map.entry("workbookAdded", !Arrays.equals(personalWorkbook, mergedWorkbook.bytes())),
                            Map.entry("sourceRetained", true),
                            Map.entry("sharedMaterialPreserved", true));
                }));
    }

    private void validate(AuthenticatedUser actor, UUID teacherId, String eventId,
            UUID studentId, UUID draftId) {
        AuthenticatedUser teacher = access.requireTeacher(actor, teacherId);
        workbooks.requireLessonStudent(teacher, eventId, studentId);
        for (String kind : List.of("workbook", "answers"))
            if (!eventId.equals(drafts.previewFile(teacher, draftId, kind).eventId()))
                throw new IllegalArgumentException("The draft belongs to a different lesson");
    }

    /**
     * Pure PDF assembly used by the reviewed-draft route. The source PDFs are
     * never mutated, and any corrupt document or oversized result fails before
     * touching either personal slot.
     */
    static MergePdf addPages(byte[] personal, byte[] shared, byte[] draft, UUID draftId) {
        LessonPdfUpload.validate(draft);
        if (personal != null) LessonPdfUpload.validate(personal);
        if (shared != null) LessonPdfUpload.validate(shared);

        if (personal != null && containsDraftId(personal, draftId))
            return new MergePdf(personal, pageCount(personal), true);

        if (personal != null && Arrays.equals(personal, draft)) {
            // A previous version already attached this draft as a single PDF.
            // Inherit the older shared workbook only once, if it exists.
            if (shared == null || Arrays.equals(shared, personal))
                return new MergePdf(personal, pageCount(personal), false);
            return merge(shared, personal, draftId);
        }

        if (personal != null) return merge(personal, draft, draftId);
        if (shared != null && !Arrays.equals(shared, draft))
            return merge(shared, draft, draftId);
        return new MergePdf(draft, pageCount(draft), false);
    }

    record MergePdf(byte[] bytes, int pages, boolean combined) {}

    private static boolean containsDraftId(byte[] pdf, UUID draftId) {
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            String metadata = doc.getDocumentInformation().getCustomMetadataValue(DRAFT_IDS_METADATA);
            return metadata != null && Arrays.asList(metadata.split(",")).contains(draftId.toString());
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Stored PDF is not readable", ex);
        }
    }

    private static int pageCount(byte[] pdf) {
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            return doc.getNumberOfPages();
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PDF is not readable", ex);
        }
    }

    private static MergePdf merge(byte[] base, byte[] addition, UUID draftId) {
        try (PDDocument existing = Loader.loadPDF(base);
             PDDocument extra = Loader.loadPDF(addition)) {
            int expected = existing.getNumberOfPages() + extra.getNumberOfPages();
            if (expected > MAX_COMBINED_PAGES)
                throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Combined workbook exceeds 1000 A4 pages");
            String previous = existing.getDocumentInformation().getCustomMetadataValue(DRAFT_IDS_METADATA);
            List<String> ids = new ArrayList<>();
            if (previous != null && !previous.isBlank()) ids.addAll(Arrays.asList(previous.split(",")));
            if (!ids.contains(draftId.toString())) ids.add(draftId.toString());
            new PDFMergerUtility().appendDocument(existing, extra);
            existing.getDocumentInformation().setCustomMetadataValue(DRAFT_IDS_METADATA, String.join(",", ids));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            existing.save(out);
            byte[] combined = out.toByteArray();
            LessonPdfUpload.validate(combined);
            return new MergePdf(combined, expected, true);
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Could not combine the existing and new workbook PDFs; previous files remain unchanged", ex);
        }
    }
}
