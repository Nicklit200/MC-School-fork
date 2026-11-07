package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbook;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbookRepository;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbookService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Confirmed append only. The caller serializes confirmations by locking its generated artifact. */
@Service
public class KolinWorkbookAppendService {
    static final int MAX_PDF_BYTES = 25 * 1024 * 1024;
    static final int MAX_TOTAL_PAGES = 1000;
    static final int MAX_GENERATED_PAGES = 10;
    private final OnlineClassAccessService access;
    private final PersonalLessonWorkbookService personal;
    private final PersonalLessonWorkbookRepository workbooks;
    private final LessonPreparationRepository preparations;
    private final OnlineClassAnnotationDocumentRepository documents;
    private final EntityManager entities;

    public KolinWorkbookAppendService(OnlineClassAccessService access, PersonalLessonWorkbookService personal,
            PersonalLessonWorkbookRepository workbooks, LessonPreparationRepository preparations,
            OnlineClassAnnotationDocumentRepository documents, EntityManager entities) {
        this.access = access; this.personal = personal; this.workbooks = workbooks;
        this.preparations = preparations; this.documents = documents; this.entities = entities;
    }

    /** Page numbers are one-based and inclusive; version is the normal personal PDF revision. */
    public record Result(int fromPage, int toPage, long version) {}

    @Transactional
    public Result append(AuthenticatedUser teacher, OnlineClass requestedRoom, UUID studentId, byte[] generatedPdf) {
        OnlineClass room = access.requireHostForUpdate(teacher, requestedRoom.getId());
        entities.refresh(room, LockModeType.PESSIMISTIC_WRITE);
        if (!access.isHost(teacher, room)) throw new ResourceNotFoundException("Online class not found");
        if (room.isTerminal()) throw new ConflictException("This class has ended");
        if (!personal.enabledForTeacher(teacher.id())) throw new ResourceNotFoundException("Personal workbook not found");
        boolean group=studentId==null;
        if(!group) personal.requireClassStudent(room, studentId);
        requireBytes(generatedPdf);

        PersonalLessonWorkbook current = group?null:workbooks.findByTeacherIdAndEventIdAndStudentId(
                teacher.id(), room.getEventId(), studentId).orElse(null);
        String target = group?"board-1":PersonalBoard.workbookTargetIdFor(studentId);
        String inheritedTarget = group?"board-1":PersonalBoard.targetIdFor(studentId);
        var all = documents.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId());
        var legacy = pages(all, inheritedTarget);
        var privatePages = pages(all, target);
        if (!group && current == null && !privatePages.isEmpty())
            throw new ConflictException("A private annotation scope already exists without a workbook; review it before appending");
        // Shared backgrounds are also inherited by pupils without private PDFs. Preserve their blank ink pages.
        List<OnlineClassAnnotationDocument> activePages = group?all.stream().filter(page ->
                page.getTargetType()==AnnotationTargetType.WHITEBOARD && !PersonalBoard.isWorkbook(page.getTargetId())).toList()
                :current == null ? legacy : privatePages;
        long extentLong = activePages.stream().mapToLong(page -> (long) page.getPageIndex() + 1L).max().orElse(0L);
        if (extentLong < 0 || extentLong > MAX_TOTAL_PAGES) throw new ConflictException("The student's board has too many pages");
        int extent = (int) extentLong;
        byte[] base;
        com.mcschool.flashcard.lessons.LessonPreparation shared=null;
        if (current == null) {
            // Ensure normal lesson/archive metadata without refreshing Calendar or changing shared files.
            preparations.insertIfAbsent(teacher.id(), room.getEventId());
            var inherited = preparations.findByTeacherIdAndEventId(teacher.id(), room.getEventId()).orElseThrow();
            // Keep the inherited background stable against a simultaneous shared PDF upload.
            entities.refresh(inherited, group?LockModeType.PESSIMISTIC_WRITE:LockModeType.PESSIMISTIC_READ);
            if(group) shared=inherited;
            base = inherited.hasWorkbook() ? inherited.getWorkbookPdf() : null;
        } else base = current.getWorkbookPdf();
        if (current != null && base == null) throw new ConflictException("The existing private workbook is unreadable");
        if (base != null) requireBytes(base);

        try (PDDocument addition = Loader.loadPDF(generatedPdf);
             PDDocument merged = base == null ? new PDDocument() : Loader.loadPDF(base)) {
            if (addition.isEncrypted() || addition.getNumberOfPages() < 1 || addition.getNumberOfPages() > MAX_GENERATED_PAGES
                    || merged.isEncrypted() || (base != null && merged.getNumberOfPages() < 1))
                throw new ConflictException("PDF pages are not valid for append");
            int previousPages = Math.max(merged.getNumberOfPages(), extent);
            int total = previousPages + addition.getNumberOfPages();
            if (total > MAX_TOTAL_PAGES) throw new ConflictException("The student's workbook has too many pages");
            PDRectangle size = merged.getNumberOfPages() == 0 ? PDRectangle.A4
                    : merged.getPage(merged.getNumberOfPages() - 1).getMediaBox();
            while (merged.getNumberOfPages() < previousPages)
                merged.addPage(new PDPage(blankSize(activePages, merged.getNumberOfPages(), size)));
            new PDFMergerUtility().appendDocument(merged, addition);
            var output = new ByteArrayOutputStream();
            merged.save(output);
            byte[] bytes = output.toByteArray();
            requireBytes(bytes);

            if(group) {
                shared.attachWorkbook("lesson-workbook.pdf",bytes);
                preparations.saveAndFlush(shared);
                return new Result(previousPages+1,total,shared.getWorkbookVersion());
            }
            if (current == null) {
                current = PersonalLessonWorkbook.create(teacher.id(), room.getEventId(), studentId);
                // Retarget, never copy/delete. Old document IDs and in-flight strokes remain valid.
                for (var page : legacy) page.promoteToPersonalWorkbook(studentId);
                documents.flush();
            }
            String filename = current.getFilename() == null ? "personal-workbook.pdf" : current.getFilename();
            current.attach(filename, bytes);
            PersonalLessonWorkbook saved = workbooks.saveAndFlush(current);
            return new Result(previousPages + 1, total, saved.documentVersion());
        } catch (ObjectOptimisticLockingFailureException | DataIntegrityViolationException ex) {
            throw new ConflictException("The student's workbook changed; reload before confirming again");
        } catch (IOException ex) {
            throw new ConflictException("The existing or generated PDF could not be read");
        }
    }

    private static List<OnlineClassAnnotationDocument> pages(List<OnlineClassAnnotationDocument> all, String target) {
        return all.stream().filter(page -> page.getTargetType() == AnnotationTargetType.WHITEBOARD
                && target.equals(page.getTargetId())).toList();
    }

    private static PDRectangle blankSize(List<OnlineClassAnnotationDocument> pages, int index, PDRectangle fallback) {
        return pages.stream().filter(page -> page.getPageIndex() == index && page.getSourceWidth() != null
                        && page.getSourceHeight() != null && page.getSourceWidth() > 0 && page.getSourceHeight() > 0)
                .findFirst().map(page -> new PDRectangle(page.getSourceWidth(), page.getSourceHeight())).orElse(fallback);
    }

    private static void requireBytes(byte[] bytes) {
        if (bytes == null || bytes.length < 5 || bytes.length > MAX_PDF_BYTES
                || bytes[0] != '%' || bytes[1] != 'P' || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-')
            throw new ConflictException("PDF size or format is not valid for append");
    }
}
