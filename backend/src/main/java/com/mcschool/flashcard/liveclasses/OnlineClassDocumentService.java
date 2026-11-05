package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbook;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbookService;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The lesson's workbook as the shared board document.
 *
 * <p>Participants (the owning teacher and the bound student or group members)
 * may read the workbook, because it is what the lesson is worked on. The
 * answers file lives in the same {@code lesson_preparations} row but is never
 * reachable from here: only {@link LessonPreparation#getWorkbookPdf()} is read,
 * and the teacher-only lesson-preparation API remains the sole route to
 * answers.
 */
@Service
public class OnlineClassDocumentService {

    private final OnlineClassAccessService accessService;
    private final LessonPreparationRepository preparations;
    private final PersonalLessonWorkbookService personalWorkbooks;

    public OnlineClassDocumentService(OnlineClassAccessService accessService,
                                      LessonPreparationRepository preparations,
                                      PersonalLessonWorkbookService personalWorkbooks) {
        this.accessService = accessService;
        this.preparations = preparations;
        this.personalWorkbooks = personalWorkbooks;
    }

    /**
     * The workbook PDF bytes, empty when the lesson has none. An outsider gets
     * not-found from the access check, indistinguishable from a missing class.
     */
    @Transactional(readOnly = true)
    public Optional<byte[]> workbook(AuthenticatedUser caller, UUID classId) {
        return workbook(caller, classId, null);
    }

    @Transactional(readOnly = true)
    public Optional<byte[]> workbook(AuthenticatedUser caller, UUID classId, String boardId) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        UUID studentId = personalBoardOwner(caller, onlineClass, boardId);
        if (PersonalBoard.isWorkbook(boardId)) {
            requireWorkbookPilot(onlineClass);
            return personalWorkbooks.workbookForClass(onlineClass, studentId)
                    .map(PersonalLessonWorkbook::getWorkbookPdf);
        }
        return preparations
                .findByTeacherIdAndEventId(onlineClass.getTeacher().getId(), onlineClass.getEventId())
                .filter(LessonPreparation::hasWorkbook)
                .map(LessonPreparation::getWorkbookPdf);
    }

    /** Cheap revision probe: no PDF bytes are sent during polling. */
    @Transactional(readOnly = true)
    public long workbookVersion(AuthenticatedUser caller, UUID classId) {
        return workbookVersion(caller, classId, null);
    }

    @Transactional(readOnly = true)
    public long workbookVersion(AuthenticatedUser caller, UUID classId, String boardId) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        UUID studentId = personalBoardOwner(caller, onlineClass, boardId);
        if (PersonalBoard.isWorkbook(boardId)) {
            // An authorized owner may probe whether My board has a private
            // source. Non-pilot classes use the common source; bytes and
            // annotations still reject this private target as before.
            if (!PersonalLessonWorkbookService.PILOT_TEACHER_ID.equals(onlineClass.getTeacher().getId())) return 0L;
            return personalWorkbooks.workbookVersionForClass(onlineClass, studentId);
        }
        return preparations.findByTeacherIdAndEventId(
                        onlineClass.getTeacher().getId(), onlineClass.getEventId())
                .filter(LessonPreparation::hasWorkbook)
                // Poll the PDF revision, not the row's optimistic-lock version:
                // notes, answers and live transcripts must not reload the board.
                .map(LessonPreparation::getWorkbookVersion)
                .orElse(0L);
    }

    private UUID personalBoardOwner(AuthenticatedUser caller, OnlineClass lesson, String boardId) {
        if (boardId == null || boardId.isBlank() || "board-1".equals(boardId)) return null;
        UUID owner = PersonalBoard.ownerOf(boardId)
                .orElseThrow(() -> new ResourceNotFoundException("Board document not found"));
        if (!accessService.isHost(caller, lesson) && !owner.equals(caller.id())) {
            throw new ResourceNotFoundException("Board document not found");
        }
        personalWorkbooks.requireClassStudent(lesson, owner);
        return owner;
    }

    private void requireWorkbookPilot(OnlineClass lesson) {
        if (!PersonalLessonWorkbookService.PILOT_TEACHER_ID.equals(lesson.getTeacher().getId())) {
            throw new ResourceNotFoundException("Board document not found");
        }
    }

    /** Assignment-only details: no private lesson plan, transcript or answer key. */
    public record HomeworkSummary(String notes, boolean hasDocument) {}

    @Transactional(readOnly = true)
    public HomeworkSummary homework(AuthenticatedUser caller, UUID classId) {
        OnlineClass lesson = accessService.requireAdmitted(caller, classId);
        return preparations
                .findByTeacherIdAndEventId(lesson.getTeacher().getId(), lesson.getEventId())
                .map(p -> new HomeworkSummary(p.getHomeworkNotes(), p.hasWorkbook()))
                .orElseGet(() -> new HomeworkSummary(null, false));
    }
}
