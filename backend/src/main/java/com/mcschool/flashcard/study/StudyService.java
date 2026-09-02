package com.mcschool.flashcard.study;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.CardStatus;
import com.mcschool.flashcard.cards.dto.CardResponse;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.study.dto.AnswerRequest;
import com.mcschool.flashcard.study.dto.AnswerResultResponse;
import com.mcschool.flashcard.study.dto.QuestionResponse;
import com.mcschool.flashcard.study.dto.SessionResponse;
import com.mcschool.flashcard.study.dto.SessionReviewItemResponse;
import com.mcschool.flashcard.study.dto.SessionResultResponse;
import com.mcschool.flashcard.study.dto.StartSessionRequest;
import com.mcschool.flashcard.study.dto.TodayResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudyService {

    public static final int MIN_CARDS_TO_START = 4;
    private static final Logger log = LoggerFactory.getLogger(StudyService.class);
    private static final DateTimeFormatter EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");

    private final StudySessionRepository sessionRepository;
    private final StudySessionItemRepository itemRepository;
    private final CardRepository cardRepository;
    private final HomeworkRepository homeworkRepository;
    private final UserRepository userRepository;
    private final Sm2Scheduler sm2Scheduler;
    private final DistractorGenerator distractorGenerator;
    private final DailyReviewHistoryService historyService;
    private final GoogleDriveService googleDriveService;
    private final ZoneId reviewHistoryZone;

    public StudyService(StudySessionRepository sessionRepository,
                        StudySessionItemRepository itemRepository,
                        CardRepository cardRepository,
                        HomeworkRepository homeworkRepository,
                        UserRepository userRepository,
                        Sm2Scheduler sm2Scheduler,
                        DistractorGenerator distractorGenerator,
                        DailyReviewHistoryService historyService,
                        GoogleDriveService googleDriveService,
                        @Value("${app.notifications.review-reminders.zone}") String reviewHistoryZone) {
        this.sessionRepository = sessionRepository;
        this.itemRepository = itemRepository;
        this.cardRepository = cardRepository;
        this.homeworkRepository = homeworkRepository;
        this.userRepository = userRepository;
        this.sm2Scheduler = sm2Scheduler;
        this.distractorGenerator = distractorGenerator;
        this.historyService = historyService;
        this.googleDriveService = googleDriveService;
        this.reviewHistoryZone = ZoneId.of(reviewHistoryZone);
    }

    @Transactional(readOnly = true)
    public TodayResponse today(AuthenticatedUser student) {
        UUID studentId = student.id();
        LocalDate today = LocalDate.now();
        long total = cardRepository.countByStudentIdAndArchivedFalse(studentId);
        long available = cardRepository.countAvailableStudyCards(studentId, today);
        long learned = cardRepository.countByStudentIdAndStatusAndArchivedFalse(studentId, CardStatus.LEARNED);
        long due = cardRepository.countDueCards(studentId, today);
        UUID inProgress = sessionRepository
                .findByStudentIdAndStatus(studentId, SessionStatus.IN_PROGRESS)
                .map(StudySession::getId)
                .orElse(null);
        boolean enoughCards = available >= MIN_CARDS_TO_START;
        return new TodayResponse(total, due, learned, MIN_CARDS_TO_START,
                enoughCards && due > 0, enoughCards, inProgress);
    }

    @Transactional(readOnly = true)
    public List<CardResponse> listMyCards(AuthenticatedUser student) {
        return cardRepository.findAllByStudentIdAndArchivedFalseOrderByCreatedAtDesc(student.id()).stream()
                .map(CardResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<CardResponse> listHomeworkCards(AuthenticatedUser student, UUID homeworkId) {
        requireOwnedHomework(student.id(), homeworkId);
        return cardRepository
                .findAllByHomeworkIdAndStudentIdAndArchivedFalseOrderByCreatedAtDesc(homeworkId, student.id())
                .stream()
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
        List<Card> cards = selectCardsForSession(studentId, request);
        if (availableCardsForSession(studentId, request, cards) < MIN_CARDS_TO_START) {
            throw new ConflictException("NOT_ENOUGH_CARDS",
                    "At least " + MIN_CARDS_TO_START + " cards are needed to start a session");
        }

        User studentEntity = userRepository.findById(studentId)
                .orElseThrow(() -> new ResourceNotFoundException("Student account no longer exists"));

        StudySession session = sessionRepository.save(
                StudySession.start(studentEntity, request.type(), cards.size()));
        if (session.isScheduled()) {
            historyService.recordScheduledSessionStarted(studentEntity, reviewHistoryToday(), cards.size());
        }
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
                itemRepository.findAllBySessionId(sessionId).stream()
                        .map(StudySessionItem::getCard)
                        .toList());
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
        item.recordSelectedAnswer(selectedAnswer);
        boolean correct = card.getCorrectAnswer().equals(selectedAnswer);
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
                session.getCorrectFirstTry(), soonestNextReview(sessionId), reviewItems(sessionId));
    }

    private List<Card> selectCardsForSession(UUID studentId, StartSessionRequest request) {
        if (request.type() == SessionType.SCHEDULED) {
            List<Card> due = cardRepository.findDueCards(studentId, LocalDate.now());
            if (due.isEmpty()) {
                throw new ConflictException("NO_CARDS_DUE", "No cards are due for review today");
            }
            return due;
        }
        if (request.homeworkId() != null) {
            requireOwnedHomework(studentId, request.homeworkId());
            return cardRepository.findAllByHomeworkIdAndStudentIdAndArchivedFalseOrderByCreatedAtDesc(
                    request.homeworkId(), studentId);
        }
        return cardRepository.findAvailableStudyCards(studentId, LocalDate.now());
    }

    private long availableCardsForSession(UUID studentId, StartSessionRequest request, List<Card> selectedCards) {
        if (request.type() == SessionType.SCHEDULED) {
            return cardRepository.countAvailableStudyCards(studentId, LocalDate.now());
        }
        return selectedCards.size();
    }

    private void completeSession(StudySession session) {
        session.markCompleted();

        if (session.isScheduled()) {
            LocalDate today = LocalDate.now();
            historyService.recordScheduledSessionCompleted(session.getStudent(), reviewHistoryToday(),
                    session.getTotalCards());
            for (StudySessionItem item : itemRepository.findAllBySessionId(session.getId())) {
                Card card = item.getCard();
                Sm2Scheduler.Scheduling next = sm2Scheduler.afterReview(card.getRepetitionNumber(),
                        item.isFirstTryClean(), today);
                card.applyScheduling(next.repetitionNumber(), next.dueDate(), next.status());
            }
        }

        exportSessionToGoogleDrive(session);
    }

    private void exportSessionToGoogleDrive(StudySession session) {
        User student = session.getStudent();
        String folderId = student.getGoogleDriveFolderUrl();
        if (folderId == null || folderId.isBlank()) {
            return;
        }

        try {
            List<SessionReviewItemResponse> rows = reviewItems(session.getId());
            int correct = (int) rows.stream().filter(SessionReviewItemResponse::correct).count();
            int wrong = rows.size() - correct;

            StringBuilder csv = new StringBuilder("\uFEFF");
            csv.append("Student;Session type;Total;Correct first try;Wrong first try\r\n");
            csv.append(csvCell(student.getFullName())).append(';')
                    .append(csvCell(session.getSessionType().name())).append(';')
                    .append(rows.size()).append(';')
                    .append(correct).append(';')
                    .append(wrong).append("\r\n\r\n");
            csv.append("Question;Student answer;Correct answer;Result\r\n");
            for (SessionReviewItemResponse row : rows) {
                csv.append(csvCell(row.question())).append(';')
                        .append(csvCell(row.selectedAnswer())).append(';')
                        .append(csvCell(row.correctAnswer())).append(';')
                        .append(row.correct() ? "CORRECT" : "WRONG")
                        .append("\r\n");
            }

            String timestamp = session.getCompletedAt()
                    .atZone(reviewHistoryZone)
                    .format(EXPORT_TIME);
            String fileName = safeFileName(student.getFullName()) + "_" + timestamp + "_cards.csv";
            googleDriveService.uploadBytes(folderId, fileName, "text/csv; charset=utf-8",
                    csv.toString().getBytes(StandardCharsets.UTF_8));
            log.info("Uploaded completed card session to Google Drive: studentId={} sessionId={} file={}",
                    student.getId(), session.getId(), fileName);
        } catch (Exception ex) {
            log.error("Could not export completed card session to Google Drive: studentId={} sessionId={}",
                    student.getId(), session.getId(), ex);
        }
    }

    private String safeFileName(String value) {
        if (value == null || value.isBlank()) {
            return "student";
        }
        String cleaned = value.trim().replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\s+", "_");
        return cleaned.isBlank() ? "student" : cleaned;
    }

    private String csvCell(String value) {
        if (value == null) {
            return "\"\"";
        }
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private LocalDate reviewHistoryToday() {
        return LocalDate.now(reviewHistoryZone);
    }

    private LocalDate soonestNextReview(UUID sessionId) {
        return itemRepository.findAllBySessionId(sessionId).stream()
                .map(StudySessionItem::getCard)
                .filter(card -> card.getStatus() == CardStatus.ACTIVE && card.getDueDate() != null)
                .map(Card::getDueDate)
                .min(Comparator.naturalOrder())
                .orElse(null);
    }

    private List<SessionReviewItemResponse> reviewItems(UUID sessionId) {
        return itemRepository.findAllBySessionId(sessionId).stream()
                .filter(item -> item.getFirstSelectedAnswer() != null)
                .sorted(Comparator.comparing(StudySessionItem::getCreatedAt)
                        .thenComparing(StudySessionItem::getId))
                .map(item -> {
                    Card card = item.getCard();
                    String selectedAnswer = item.getFirstSelectedAnswer();
                    boolean correct = card.getCorrectAnswer().equals(selectedAnswer);
                    return new SessionReviewItemResponse(card.getId(), card.getQuestion(),
                            selectedAnswer, card.getCorrectAnswer(), correct);
                })
                .toList();
    }

    private StudySession requireOwnedSession(UUID studentId, UUID sessionId) {
        return sessionRepository.findByIdAndStudentId(sessionId, studentId)
                .orElseThrow(() -> new ResourceNotFoundException("Session not found"));
    }

    private void requireOwnedHomework(UUID studentId, UUID homeworkId) {
        homeworkRepository.findByIdAndStudentId(homeworkId, studentId)
                .orElseThrow(() -> new ResourceNotFoundException("Homework not found"));
    }
}
