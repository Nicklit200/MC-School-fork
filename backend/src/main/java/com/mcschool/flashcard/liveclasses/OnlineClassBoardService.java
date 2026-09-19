package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassBoardContextResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassBoardStudentResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassWorkbookResponse;
import com.mcschool.flashcard.users.Role;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Shared/private board context plus read-only lesson workbook rendering.
 *
 * The calendar lesson preparation remains the single source of truth for the
 * workbook. Online classes only expose it to authorized class participants.
 */
@Service
public class OnlineClassBoardService {

    private final OnlineClassAccessService accessService;
    private final LessonPreparationRepository preparationRepository;
    private final OnlineClassParticipantRepository participantRepository;

    public OnlineClassBoardService(OnlineClassAccessService accessService,
                                   LessonPreparationRepository preparationRepository,
                                   OnlineClassParticipantRepository participantRepository) {
        this.accessService = accessService;
        this.preparationRepository = preparationRepository;
        this.participantRepository = participantRepository;
    }

    @Transactional(readOnly = true)
    public OnlineClassBoardContextResponse context(AuthenticatedUser caller, java.util.UUID classId) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        boolean host = accessService.isHost(caller, onlineClass);

        List<OnlineClassBoardStudentResponse> students;
        if (host) {
            students = participantRepository
                    .findAllByOnlineClassIdOrderByCreatedAtAsc(classId)
                    .stream()
                    .filter(participant -> !participant.isHost())
                    .filter(OnlineClassParticipant::isConnected)
                    .map(participant -> new OnlineClassBoardStudentResponse(
                            participant.getUser().getId(),
                            participant.getUser().getFullName()))
                    .sorted(java.util.Comparator.comparing(
                            OnlineClassBoardStudentResponse::fullName,
                            String.CASE_INSENSITIVE_ORDER))
                    .toList();
        } else {
            students = List.of(new OnlineClassBoardStudentResponse(
                    caller.id(),
                    accessService.requireActiveUser(caller.id()).getFullName()));
        }

        return new OnlineClassBoardContextResponse(
                onlineClass.getTeacher().getId(),
                students,
                workbookMetadata(onlineClass));
    }

    @Transactional(readOnly = true)
    public byte[] renderWorkbookPage(AuthenticatedUser caller, java.util.UUID classId, int pageIndex) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        LessonPreparation preparation = preparation(onlineClass);
        if (preparation == null || !preparation.hasWorkbook()) {
            throw new ResourceNotFoundException("Workbook not found");
        }

        try (PDDocument document = Loader.loadPDF(preparation.getWorkbookPdf());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (pageIndex < 0 || pageIndex >= document.getNumberOfPages()) {
                throw new ResourceNotFoundException("Workbook page not found");
            }
            PDFRenderer renderer = new PDFRenderer(document);
            BufferedImage image = renderer.renderImageWithDPI(pageIndex, 144f);
            ImageIO.write(image, "png", output);
            return output.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Workbook could not be rendered", e);
        }
    }

    private OnlineClassWorkbookResponse workbookMetadata(OnlineClass onlineClass) {
        LessonPreparation preparation = preparation(onlineClass);
        if (preparation == null || !preparation.hasWorkbook()) {
            return new OnlineClassWorkbookResponse(false, null, 0, 0, 0);
        }

        try (PDDocument document = Loader.loadPDF(preparation.getWorkbookPdf())) {
            if (document.getNumberOfPages() == 0) {
                return new OnlineClassWorkbookResponse(false, preparation.getWorkbookFilename(), 0, 0, 0);
            }
            var box = document.getPage(0).getMediaBox();
            return new OnlineClassWorkbookResponse(
                    true,
                    preparation.getWorkbookFilename(),
                    document.getNumberOfPages(),
                    box.getWidth(),
                    box.getHeight());
        } catch (IOException e) {
            throw new IllegalStateException("Workbook could not be read", e);
        }
    }

    private LessonPreparation preparation(OnlineClass onlineClass) {
        return preparationRepository
                .findByTeacherIdAndEventId(
                        onlineClass.getTeacher().getId(),
                        onlineClass.getEventId())
                .orElse(null);
    }
}
