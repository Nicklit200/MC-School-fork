package com.mcschool.flashcard.cards;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.dto.CardResponse;
import com.mcschool.flashcard.cards.dto.CardSummaryResponse;
import com.mcschool.flashcard.cards.dto.CreateCardRequest;
import com.mcschool.flashcard.cards.dto.ImportCardsRequest;
import com.mcschool.flashcard.cards.dto.ImportPreviewRequest;
import com.mcschool.flashcard.cards.dto.ImportPreviewResponse;
import com.mcschool.flashcard.cards.dto.UpdateCardRequest;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.notifications.CardPushNotificationService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Teacher-facing flashcard management. Every operation is scoped to the calling
 * teacher: a teacher may only touch cards belonging to their own students, so a
 * teacher can never see or change another teacher's material (PRD key principles).
 */
@Service
public class CardService {

    private final CardRepository cardRepository;
    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardImportParser importParser;
    private final CardPushNotificationService cardPushNotificationService;

    public CardService(CardRepository cardRepository, UserRepository userRepository,
                       HomeworkRepository homeworkRepository, CardImportParser importParser,
                       CardPushNotificationService cardPushNotificationService) {
        this.cardRepository = cardRepository;
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.importParser = importParser;
        this.cardPushNotificationService = cardPushNotificationService;
    }

    // --- Import ---

    /** Stateless: parses pasted text into a preview without saving anything. */
    public ImportPreviewResponse previewImport(ImportPreviewRequest request) {
        return importParser.parse(request.rawText(), request.questionAnswerSeparator(),
                request.cardSeparator());
    }

    @Transactional
    public List<CardResponse> importCardsIntoHomework(AuthenticatedUser teacher, UUID homeworkId,
                                                      ImportCardsRequest request) {
        User teacherEntity = requireTeacher(teacher.id());
        Homework homework = requireOwnedHomework(teacher.id(), homeworkId);
        List<CardResponse> created = request.cards().stream()
                .map(parsed -> cardRepository.save(
                        Card.createImported(homework, teacherEntity, parsed.question(), parsed.correctAnswer(),
                                parsed.wrongAnswer1(), parsed.wrongAnswer2(), parsed.wrongAnswer3())))
                .map(CardResponse::from)
                .toList();
        if (!created.isEmpty()) {
            cardPushNotificationService.notifyCardsAssigned(
                    homework.getStudent().getId(), homework.getId(), homework.getStartDate());
        }
        return created;
    }

    // --- CRUD ---

    @Transactional
    public CardResponse createCardInHomework(AuthenticatedUser teacher, UUID homeworkId,
                                             CreateCardRequest request) {
        User teacherEntity = requireTeacher(teacher.id());
        Homework homework = requireOwnedHomework(teacher.id(), homeworkId);
        Card card = cardRepository.save(
                Card.create(homework, teacherEntity, request.question(), request.correctAnswer()));
        cardPushNotificationService.notifyCardsAssigned(
                homework.getStudent().getId(), homework.getId(), homework.getStartDate());
        return CardResponse.from(card);
    }

    @Transactional(readOnly = true)
    public List<CardResponse> listCards(AuthenticatedUser teacher, UUID studentId) {
        requireOwnedStudent(teacher.id(), studentId);
        return cardRepository.findAllByStudentIdAndArchivedFalseOrderByCreatedAtDesc(studentId).stream()
                .map(CardResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<CardResponse> listCardsForHomework(AuthenticatedUser teacher, UUID homeworkId) {
        Homework homework = requireOwnedHomework(teacher.id(), homeworkId);
        return cardRepository.findAllByHomeworkIdAndArchivedFalseOrderByCreatedAtDesc(homework.getId()).stream()
                .map(CardResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public CardSummaryResponse summary(AuthenticatedUser teacher, UUID studentId) {
        requireOwnedStudent(teacher.id(), studentId);
        LocalDate today = LocalDate.now();
        long total = cardRepository.countByStudentIdAndArchivedFalse(studentId);
        long learned = cardRepository.countByStudentIdAndStatusAndArchivedFalse(studentId, CardStatus.LEARNED);
        long dueNow = cardRepository.countDueCards(studentId, today);
        long awaiting = total - learned - dueNow;
        return new CardSummaryResponse(total, dueNow, awaiting, learned);
    }

    @Transactional
    public CardResponse updateCard(AuthenticatedUser teacher, UUID cardId, UpdateCardRequest request) {
        Card card = requireOwnedCard(teacher.id(), cardId);
        card.edit(request.question(), request.correctAnswer());
        return CardResponse.from(card);
    }

    /**
     * "Deletes" a card by archiving it. The row is kept so study-session history that
     * references it stays intact and no foreign-key violation can occur.
     */
    @Transactional
    public void deleteCard(AuthenticatedUser teacher, UUID cardId) {
        Card card = requireOwnedCard(teacher.id(), cardId);
        card.archive();
    }

    // --- Ownership helpers ---
    // "Not found" (rather than "forbidden") is returned when a student or card
    // exists but belongs to another teacher, so the API never confirms that
    // someone else's resource exists.

    private User requireTeacher(UUID teacherId) {
        return userRepository.findById(teacherId)
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
    }

    private User requireOwnedStudent(UUID teacherId, UUID studentId) {
        User student = userRepository.findById(studentId)
                .filter(u -> u.getRole() == Role.STUDENT)
                .filter(u -> !u.isArchived())
                .filter(u -> u.getTeacher() != null && u.getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        return student;
    }

    private Card requireOwnedCard(UUID teacherId, UUID cardId) {
        return cardRepository.findById(cardId)
                .filter(card -> !card.isArchived())
                .filter(card -> card.getStudent().getTeacher() != null
                        && card.getStudent().getTeacher().getId().equals(teacherId))
                .orElseThrow(() -> new ResourceNotFoundException("Card not found"));
    }

    private Homework requireOwnedHomework(UUID teacherId, UUID homeworkId) {
        return homeworkRepository.findById(homeworkId)
                .filter(homework -> homework.getStudent().getTeacher() != null
                        && homework.getStudent().getTeacher().getId().equals(teacherId))
                .filter(homework -> !homework.getStudent().isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Homework not found"));
    }
}
