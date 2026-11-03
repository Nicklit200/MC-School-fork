package com.mcschool.flashcard.study;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.study.dto.StartSessionRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** Start eligibility and question options agree for decks smaller than four cards. */
class StudyServiceSmallDeckTest {
    private final StudySessionRepository sessions = mock(StudySessionRepository.class);
    private final StudySessionItemRepository items = mock(StudySessionItemRepository.class);
    private final CardRepository cards = mock(CardRepository.class);
    private final HomeworkRepository homeworks = mock(HomeworkRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final DailyReviewHistoryService history = mock(DailyReviewHistoryService.class);
    private final StudyService service = new StudyService(sessions, items, cards, homeworks, users,
            new Sm2Scheduler(), new DistractorGenerator(), history, mock(GoogleDriveService.class), "Europe/Berlin");
    private final User teacher = User.activeTeacher("Teacher", "tiny@teacher.test", "tiny-teacher", "unused");
    private final User student = User.managedStudent("Student", teacher);
    private final AuthenticatedUser caller = new AuthenticatedUser(student.getId(), null, Role.STUDENT);
    private final Homework homework = Homework.create(student, LocalDate.now());
    private final List<StudySessionItem> savedItems = new ArrayList<>();
    private StudySession savedSession;

    @BeforeEach
    void setup() {
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        when(sessions.save(any())).thenAnswer(call -> {
            savedSession = call.getArgument(0);
            return savedSession;
        });
        when(sessions.findByIdAndStudentId(any(), eq(student.getId()))).thenAnswer(call ->
                Optional.ofNullable(savedSession).filter(session -> session.getId().equals(call.getArgument(0))));
        when(items.save(any())).thenAnswer(call -> {
            StudySessionItem item = call.getArgument(0);
            savedItems.add(item);
            return item;
        });
        when(items.findAllBySessionId(any())).thenAnswer(call -> List.copyOf(savedItems));
        when(items.findFirstBySessionIdAndStateOrderByQueuePositionAsc(any(), eq(ItemState.PENDING)))
                .thenAnswer(call -> savedItems.stream().filter(item -> item.getState() == ItemState.PENDING).findFirst());
    }

    private List<Card> deck(int size) {
        List<Card> selected = IntStream.range(0, size)
                .mapToObj(index -> Card.create(homework, teacher, "Question " + index, "Answer " + index)).toList();
        when(cards.findDueCards(eq(student.getId()), any(LocalDate.class))).thenReturn(selected);
        when(cards.findAvailableStudyCards(eq(student.getId()), any(LocalDate.class))).thenReturn(selected);
        when(cards.countAvailableStudyCards(eq(student.getId()), any(LocalDate.class))).thenReturn((long) size);
        when(homeworks.findByIdAndStudentId(homework.getId(), student.getId())).thenReturn(Optional.of(homework));
        when(cards.findAllByHomeworkIdAndStudentIdAndArchivedFalseOrderByCreatedAtDesc(homework.getId(), student.getId()))
                .thenReturn(selected);
        return selected;
    }

    private StartSessionRequest request(String mode) {
        return new StartSessionRequest("SCHEDULED".equals(mode) ? SessionType.SCHEDULED : SessionType.PRACTICE,
                "HOMEWORK".equals(mode) ? homework.getId() : null);
    }

    @ParameterizedTest
    @CsvSource({"SCHEDULED,1", "SCHEDULED,2", "SCHEDULED,3", "PRACTICE,1", "PRACTICE,2", "PRACTICE,3",
            "HOMEWORK,1", "HOMEWORK,2", "HOMEWORK,3"})
    void oneToThreeCardsCanStartAndProduceOnlyTheSelectedDecksAnswers(String mode, int size) {
        List<Card> selected = deck(size);
        var started = service.startSession(caller, request(mode));
        assertThat(started.totalCards()).isEqualTo(size);
        assertThat(started.remaining()).isEqualTo(size);
        assertThat(started.status()).isEqualTo(SessionStatus.IN_PROGRESS);
        var question = service.currentQuestion(caller, started.id());
        assertThat(question.totalCards()).isEqualTo(size);
        assertThat(question.options()).containsExactlyInAnyOrderElementsOf(selected.stream().map(Card::getCorrectAnswer).toList());
        assertThat(question.options()).doesNotHaveDuplicates();
        verify(items, times(size)).save(any());
        if ("SCHEDULED".equals(mode)) {
            verify(history).recordScheduledSessionStarted(eq(student), any(LocalDate.class), eq(size));
        } else {
            verify(history, never()).recordScheduledSessionStarted(any(), any(), anyInt());
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2, 3})
    void todayAdvertisesTheSameOneCardBoundary(int count) {
        when(cards.countByStudentIdAndArchivedFalse(student.getId())).thenReturn((long) count);
        when(cards.countAvailableStudyCards(eq(student.getId()), any(LocalDate.class))).thenReturn((long) count);
        when(cards.countDueCards(eq(student.getId()), any(LocalDate.class))).thenReturn((long) count);
        var today = service.today(caller);
        assertThat(today.minCardsToStart()).isEqualTo(1);
        assertThat(today.canPractice()).isEqualTo(count > 0);
        assertThat(today.canStartScheduled()).isEqualTo(count > 0);
    }

    @Test
    void aStoredCardThatIsNotAvailableYetDoesNotOpenPracticeOrScheduledReview() {
        when(cards.countByStudentIdAndArchivedFalse(student.getId())).thenReturn(1L);
        var today = service.today(caller);
        assertThat(today.totalCards()).isEqualTo(1L);
        assertThat(today.canPractice()).isFalse();
        assertThat(today.canStartScheduled()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"SCHEDULED", "PRACTICE", "HOMEWORK"})
    void anEmptySelectionStillCannotCreateASession(String mode) {
        deck(0);
        var failure = assertThrows(ConflictException.class, () -> service.startSession(caller, request(mode)));
        assertThat(failure.getErrorCode()).isEqualTo("SCHEDULED".equals(mode) ? "NO_CARDS_DUE" : "NOT_ENOUGH_CARDS");
        verify(sessions, never()).save(any());
        verify(items, never()).save(any());
    }

    @Test
    void loweringTheMinimumDoesNotBypassHomeworkOwnership() {
        deck(1);
        assertThatThrownBy(() -> service.startSession(caller, new StartSessionRequest(SessionType.PRACTICE, UUID.randomUUID())))
                .isInstanceOf(ResourceNotFoundException.class).hasMessageContaining("Homework");
        verify(sessions, never()).save(any());
    }
}
