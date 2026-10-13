package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
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

    public OnlineClassDocumentService(OnlineClassAccessService accessService,
                                      LessonPreparationRepository preparations) {
        this.accessService = accessService;
        this.preparations = preparations;
    }

    /**
     * The workbook PDF bytes, empty when the lesson has none. An outsider gets
     * not-found from the access check, indistinguishable from a missing class.
     */
    @Transactional(readOnly = true)
    public Optional<byte[]> workbook(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        return preparations
                .findByTeacherIdAndEventId(onlineClass.getTeacher().getId(), onlineClass.getEventId())
                .filter(LessonPreparation::hasWorkbook)
                .map(LessonPreparation::getWorkbookPdf);
    }
}
