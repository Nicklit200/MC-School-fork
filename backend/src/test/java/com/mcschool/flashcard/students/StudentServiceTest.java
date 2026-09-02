package com.mcschool.flashcard.students;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.CardStatus;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class StudentServiceTest {

    private final UserRepository userRepository = mock(UserRepository.class);
    private final CardRepository cardRepository = mock(CardRepository.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final DailyReviewHistoryService historyService = mock(DailyReviewHistoryService.class);
    private final StudentService studentService =
            new StudentService(userRepository, cardRepository, notificationService, historyService, "Europe/Berlin");

    private final User teacherEntity = User.invitedTeacher("Teacher", "teacher@test.local",
            "token", Instant.now().plusSeconds(3600));
    private final AuthenticatedUser teacher =
            new AuthenticatedUser(teacherEntity.getId(), teacherEntity.getEmail(), Role.TEACHER);

    @Test
    void createStudentInvitesStudentOwnedByTheCallingTeacher() {
        when(userRepository.existsByEmail("student@test.local")).thenReturn(false);
        when(userRepository.findById(teacher.id())).thenReturn(Optional.of(teacherEntity));
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        StudentInvitationResponse response = studentService.createStudent(teacher,
                new CreateStudentRequest("Student One", "  Student@Test.local "));

        assertThat(response.student().role()).isEqualTo(Role.STUDENT);
        assertThat(response.student().status()).isEqualTo(UserStatus.INVITED);
        assertThat(response.student().email()).isEqualTo("student@test.local");
        assertThat(response.invitationToken()).isNotBlank();
        assertThat(response.invitationExpiresAt()).isAfter(Instant.now());
        verify(notificationService).sendInvitation(any(User.class), any(String.class));
    }

    @Test
    void createStudentRejectsDuplicateEmail() {
        when(userRepository.existsByEmail("student@test.local")).thenReturn(true);

        assertThatThrownBy(() -> studentService.createStudent(teacher,
                new CreateStudentRequest("Student One", "student@test.local")))
                .isInstanceOf(ConflictException.class);

        verify(userRepository, never()).save(any());
        verify(notificationService, never()).sendInvitation(any(), any());
    }

    @Test
    void listStudentsQueriesOnlyTheCallingTeachersStudents() {
        User student = User.invitedStudent("Student One", "student@test.local", teacherEntity,
                "token2", Instant.now().plusSeconds(3600));
        when(userRepository.findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacher.id()))
                .thenReturn(List.of(student));

        var students = studentService.listStudents(teacher);

        assertThat(students).hasSize(1);
        assertThat(students.get(0).email()).isEqualTo("student@test.local");
        assertThat(students.get(0).invitationToken()).isEqualTo("token2");
        verify(userRepository).findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(teacher.id());
    }

    @Test
    void deleteStudentArchivesOnlyOwnedStudentAndTheirCards() {
        User student = User.invitedStudent("Student One", "student@test.local", teacherEntity,
                "token2", Instant.now().plusSeconds(3600));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));

        studentService.deleteStudent(teacher, student.getId());

        assertThat(student.isArchived()).isTrue();
        assertThat(student.getInvitationToken()).isNull();
        verify(cardRepository).archiveAllByStudentId(student.getId());
    }

    @Test
    void deleteStudentRejectsAnotherTeachersStudent() {
        User otherTeacher = User.invitedTeacher("Other", "other@test.local",
                "token3", Instant.now().plusSeconds(3600));
        User student = User.invitedStudent("Student One", "student@test.local", otherTeacher,
                "token2", Instant.now().plusSeconds(3600));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));

        assertThatThrownBy(() -> studentService.deleteStudent(teacher, student.getId()))
                .isInstanceOf(ResourceNotFoundException.class);

        verify(cardRepository, never()).archiveAllByStudentId(student.getId());
    }

    @Test
    void testReviewReminderSendsOnlyWhenDueCardsExist() {
        User student = activeStudent();
        LocalDate today = LocalDate.now(ZoneId.of("Europe/Berlin"));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));
        when(cardRepository.countDueCards(student.getId(), today)).thenReturn(2L);

        var response = studentService.sendTestReviewReminder(teacher, student.getId());

        assertThat(response.studentId()).isEqualTo(student.getId());
        assertThat(response.dueCount()).isEqualTo(2L);
        assertThat(response.reminderAttempted()).isTrue();
        verify(historyService).recordDueSnapshot(student, today, 2L);
        verify(notificationService).sendDailyTaskReminder(student, 2L, 0L);
    }

    @Test
    void testReviewReminderSkipsEmailWhenNoCardsAreDue() {
        User student = activeStudent();
        LocalDate today = LocalDate.now(ZoneId.of("Europe/Berlin"));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));
        when(cardRepository.countDueCards(student.getId(), today)).thenReturn(0L);

        var response = studentService.sendTestReviewReminder(teacher, student.getId());

        assertThat(response.dueCount()).isZero();
        assertThat(response.reminderAttempted()).isFalse();
        verify(historyService, never()).recordDueSnapshot(any(), any(), anyLong());
        verify(notificationService, never()).sendDailyTaskReminder(any(), anyLong(), anyLong());
    }

    @Test
    void makeOneCardDueTodayUpdatesOneActiveCardWithoutChangingProgress() {
        User student = activeStudent();
        Card card = Card.create(Homework.create(student, LocalDate.now()), teacherEntity, "Question", "Answer");
        LocalDate today = LocalDate.now(ZoneId.of("Europe/Berlin"));
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));
        when(cardRepository.findFirstByStudentIdAndStatusAndArchivedFalseOrderByCreatedAtAsc(
                student.getId(), CardStatus.ACTIVE)).thenReturn(Optional.of(card));
        when(cardRepository.save(card)).thenReturn(card);

        var response = studentService.makeOneCardDueToday(teacher, student.getId());

        assertThat(response.id()).isEqualTo(card.getId());
        assertThat(response.question()).isEqualTo("Question");
        assertThat(response.dueDate()).isEqualTo(today);
        assertThat(card.getRepetitionNumber()).isZero();
        assertThat(card.getStatus()).isEqualTo(CardStatus.ACTIVE);
        verify(cardRepository).save(card);
    }

    private User activeStudent() {
        User student = User.invitedStudent("Student One", "student@test.local", teacherEntity,
                "token2", Instant.now().plusSeconds(3600));
        student.activate("hash");
        return student;
    }
}
