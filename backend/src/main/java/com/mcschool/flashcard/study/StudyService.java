package com.mcschool.flashcard.study;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.CardStatus;
import com.mcschool.flashcard.cards.dto.CardResponse;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.study.dto.AnswerRequest;
import com.mcschool.flashcard.study.dto.AnswerResultResponse;
import com.mcschool.flashcard.study.dto.QuestionResponse;
import com.mcschool.flashcard.study.dto.SessionResponse;
import com.mcschool.flashcard.study.dto.SessionResultResponse;
import com.mcschool.flashcard.study.dto.StartSessionRequest;
import com.mcschool.flashcard.study.dto.TodayResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudyService {

    public static final int MIN_CARDS_TO_START = 4;

    private final StudySessionRepository sessionRepository;
    private final StudySessionItemRepository itemRepository;
    private final CardRepository cardRepository;
    private final UserRepository userRepository;
    private final Sm2Scheduler sm2Scheduler;
    private final DistractorGenerator distractorGenerator;

    public StudyService(StudySessionRepository sessionRepository,
                        StudySessionItemRepository itemRepository,
                        CardRepository cardRepository,
                        UserRepository userRepository,
                        Sm2Scheduler sm2Scheduler,
                        DistractorGenerator distractorGenerator) {
        this.sessionRepository = sessionRepository;
        this.itemRepository = itemRepository;
        this.cardRepository = cardRepository;
        this.userRepository = userRepository;
        this.sm2Scheduler = sm2Scheduler;
        this.distractorGenerator = distractorGenerator;
    }

    @Transactional(readOnly = true)
    public TodayResponse today(AuthenticatedUser student) {
        UUID studentId = student.id();
        LocalDate today = LocalDate.now();
        long total = cardRepository.countByStudentIdAndArchivedFalse(studentId);
        long learned = cardRepository.countByStudentIdAndStatusAndArchivedFalse(studentId, CardStatus.LEARNED);
        long due = cardRepository.countDueCards(studentId, today);
        UUID inProgress = sessionRepository
                .findByStudentIdAndStatus(studentId, SessionStatus.IN_PROGRESS)
                .map(StudySession::getId)
                .orElse(null);
        boolean enoughCards = total >= MIN_CARDS_TO_START;
        return new TodayResponse(total, due, learned, MIN_CARDS_TO_START,
                enoughCards && due > 0, enoughCards, inProgress);
    }

    @Transactional(readOnly = true)
    public List<CardResponse> listMyCards(AuthenticatedUser student) {
        return cardRepository.findAllByStudentIdAndArchivedFalseOrderByCreatedAtDesc(student.id()).stream()
                .map(CardResponse::from)
                .toList();
    }

    @Transactional
    public SessionResponse startSession(AuthenticatedUser student, StartSessionRequest request) {
        UUID studentId = student.id();
        if (sessionRepository.existsByStudentIdAndStatus(studentId, SessionStatus.IN_PROGRESS)) {
            throw new ConflictException("SESSION_IN_PROGRESS",
                    "Finish or resume your current session before starting a new one");
        }
        long totalCards = cardRepository.countByStudentIdAndArchivedFalse(studentId);
        if (totalCards < MIN_CARDS_TO_START) {
            throw new ConflictException("NOT_ENOUGH_CARDS",
                    "At least " + MIN_CARDS_TO_START + " cards are needed to start a session");
        }

        List<Card> cards = selectCardsForSession(studentId, request.type());
        User studentEntity = userRepository.findById(studentId)
                .orElseThrow(() -> new ResourceNotFoundException("Student account no longer exists"));

        StudySession session = sessionRepository.save(
                StudySession.start(studentEntity, request.type(), cards.size()));
        int position = 0;
        for (Card card : cards) {
            itemRepository.save(StudySessionItem.create(session, card, position++));
        }
        return SessionResponse.of(session, 0);
    }

    @Transactional(readOnly = true)
    public SessionResponse getSession(AuthenticatedUser student, UUID sessionId) {
        StudySession session = requireOwnedSession(student.id(), sessionId);
        int answered = (int) itemRepository.countBySessionIdAndState(sessionId, ItemState.ANSWERED_CORRECT);
        return SessionResponse.of(session, answered);
    }

    @Transactional(readOnly = true)
    public QuestionResponse currentQuestion(AuthenticatedUser student, UUID sessionId) {
        StudySession session = requireOwnedSession(student.id(), sessionId);
        if (session.isCompleted()) {
            throw new ConflictException("SESSION_COMPLETED", "This session is already finished");
        }
        StudySessionItem item = itemRepository
                .findFirstBySessionIdAndStateOrderByQueuePositionAsc(sessionId, ItemState.PENDING)
                .orElseThrow(() -> new ConflictException("SESSION_COMPLETED", "No cards left in this session"));

        Card card = item.getCard();
        List<String> options = distractorGenerator.buildOptions(card,
                cardRepository.findAllByStudentIdAndArchivedFalseOrderByCreatedAtDesc(student.id()));
        int answered = (int) itemRepository.countBySessionIdAndState(sessionId, ItemState.ANSWERED_CORRECT);
        return new QuestionResponse(card.getId(), card.getQuestion(), options, answered, session.getTotalCards());
    }

    @Transactional
    public AnswerResultResponse answer(AuthenticatedUser student, UUID sessionId, AnswerRequest request) {
        StudySession session = requireOwnedSession(student.id(), sessionId);
        if (session.isCompleted()) {
            throw new ConflictException("SESSION_COMPLETED", "This session is already finished");
        }
        StudySessionItem item = itemRepository.findBySessionIdAndCardId(sessionId, request.cardId())
                .filter(i -> i.getState() == ItemState.PENDING)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Card is not part of this session or has already been answered"));

        Card card = item.getCard();
        String selectedAnswer = request.selectedAnswer().strip();
        boolean correct = card.getCorrectAnswer().equals(selectedAnswer);
        item.recordFirstAnswer(selectedAnswer, correct);
        if (correct) {
            if (item.isFirstTryClean()) {
                session.recordCorrectFirstTry();
            }
            item.markCorrect();
        } else {
            Integer maxPosition = itemRepository.findMaxQueuePosition(sessionId);
            item.markWrongAndRequeue((maxPosition == null ? 0 : maxPosition) + 1);
        }

        long remaining = itemRepository.countBySessionIdAndState(sessionId, ItemState.PENDING);
        boolean completed = remaining == 0;
        if (completed) {
            completeSession(session);
        }
        return new AnswerResultResponse(correct, card.getCorrectAnswer(), completed, (int) remaining);
    }

    @Transactional(readOnly = true)
    public SessionResultResponse result(AuthenticatedUser student, UUID sessionId) {
        StudySession session = requireOwnedSession(student.id(), sessionId);
        if (!session.isCompleted()) {
            throw new ConflictException("SESSION_NOT_COMPLETED", "Session is still in progress");
        }
        return new SessionResultResponse(session.getSessionType(), session.getTotalCards(),
                session.getCorrectFirstTry(), soonestNextReview(sessionId));
    }

    private List<Card> selectCardsForSession(UUID studentId, SessionType type) {
        if (type == SessionType.SCHEDULED) {
            List<Card> due = cardRepository.findDueCards(studentId, LocalDate.now());
            if (due.isEmpty()) {
                throw new ConflictException("NO_CARDS_DUE", "No cards are due for review today");
            }
            return due;
        }
        return cardRepository.findAllByStudentIdAndArchivedFalseOrderByCreatedAtDesc(studentId);
    }

    private void completeSession(StudySession session) {
        session.markCompleted();
        if (!session.isScheduled()) {
            return;
        }
        LocalDate today = LocalDate.now();
        for (StudySessionItem item : itemRepository.findAllBySessionId(session.getId())) {
            Card card = item.getCard();
            Sm2Scheduler.Scheduling next = item.isFirstTryClean()
                    ? sm2Scheduler.afterSuccessfulReview(card.getRepetitionNumber(), today)
                    : sm2Scheduler.afterReviewWithMistake(today);
            card.applyScheduling(next.repetitionNumber(), next.dueDate(), next.status());
        }
    }

    private LocalDate soonestNextReview(UUID sessionId) {
        return itemRepository.findAllBySessionId(sessionId).stream()
                .map(StudySessionItem::getCard)
                .filter(card -> card.getStatus() == CardStatus.ACTIVE && card.getDueDate() != null)
                .map(Card::getDueDate)
                .min(Comparator.naturalOrder())
                .orElse(null);
    }

    private StudySession requireOwnedSession(UUID studentId, UUID sessionId) {
        return sessionRepository.findByIdAndStudentId(sessionId, studentId)
                .orElseThrow(() -> new ResourceNotFoundException("Session not found"));
    }
}
