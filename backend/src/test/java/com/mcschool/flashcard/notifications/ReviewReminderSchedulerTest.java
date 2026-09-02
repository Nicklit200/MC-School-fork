package com.mcschool.flashcard.notifications;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;

class ReviewReminderSchedulerTest {

    private final UserRepository userRepository = mock(UserRepository.class);
    private final CardRepository cardRepository = mock(CardRepository.class);
    private final HomeworkRepository homeworkRepository = mock(HomeworkRepository.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final DailyReviewHistoryService historyService = mock(DailyReviewHistoryService.class);

    @Test
    void sendsRemindersOnlyForActiveNonArchivedStudentsUsingConfiguredZoneDate() {
        ReviewReminderScheduler scheduler = new ReviewReminderScheduler(
                userRepository, cardRepository, homeworkRepository, notificationService, historyService, "Europe/Berlin");
        User teacher = User.invitedTeacher("Teacher", "teacher@test.local",
                "teacher-token", Instant.now().plusSeconds(3600));
        User student = User.invitedStudent("Student", "student@test.local", teacher,
                "student-token", Instant.now().plusSeconds(3600));
        student.activate("hash");
        LocalDate berlinToday = LocalDate.now(ZoneId.of("Europe/Berlin"));

        when(userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)).thenReturn(List.of(student));
        when(cardRepository.countDueCards(student.getId(), berlinToday)).thenReturn(3L);
        when(homeworkRepository.countOpenWorksheetsForDay(student.getId(), berlinToday)).thenReturn(1L);

        scheduler.sendDueReminders();

        verify(userRepository).findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE);
        verify(historyService).closeIncompleteDaysBefore(berlinToday);
        verify(cardRepository).countDueCards(student.getId(), berlinToday);
        verify(homeworkRepository).countOpenWorksheetsForDay(student.getId(), berlinToday);
        verify(historyService).recordDueSnapshot(student, berlinToday, 3L);
        verify(notificationService).sendDailyTaskReminder(student, 3L, 1L);
    }

    @Test
    void skipsReminderAndHistoryWhenNoTasksAreDue() {
        ReviewReminderScheduler scheduler = new ReviewReminderScheduler(
                userRepository, cardRepository, homeworkRepository, notificationService, historyService, "Europe/Berlin");
        User teacher = User.invitedTeacher("Teacher", "teacher@test.local",
                "teacher-token", Instant.now().plusSeconds(3600));
        User student = User.invitedStudent("Student", "student@test.local", teacher,
                "student-token", Instant.now().plusSeconds(3600));
        student.activate("hash");
        LocalDate berlinToday = LocalDate.now(ZoneId.of("Europe/Berlin"));

        when(userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)).thenReturn(List.of(student));
        when(cardRepository.countDueCards(student.getId(), berlinToday)).thenReturn(0L);
        when(homeworkRepository.countOpenWorksheetsForDay(student.getId(), berlinToday)).thenReturn(0L);

        scheduler.sendDueReminders();

        verify(historyService).closeIncompleteDaysBefore(berlinToday);
        verify(historyService, never()).recordDueSnapshot(student, berlinToday, 0L);
        verify(notificationService, never()).sendDailyTaskReminder(student, 0L, 0L);
    }

    @Test
    void usesConfiguredTimezoneDateForHistoryAndDueCounts() {
        String zone = "Pacific/Kiritimati";
        ReviewReminderScheduler scheduler = new ReviewReminderScheduler(
                userRepository, cardRepository, homeworkRepository, notificationService, historyService, zone);
        User teacher = User.invitedTeacher("Teacher", "teacher@test.local",
                "teacher-token", Instant.now().plusSeconds(3600));
        User student = User.invitedStudent("Student", "student@test.local", teacher,
                "student-token", Instant.now().plusSeconds(3600));
        student.activate("hash");
        LocalDate configuredToday = LocalDate.now(ZoneId.of(zone));

        when(userRepository.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)).thenReturn(List.of(student));
        when(cardRepository.countDueCards(student.getId(), configuredToday)).thenReturn(2L);
        when(homeworkRepository.countOpenWorksheetsForDay(student.getId(), configuredToday)).thenReturn(0L);

        scheduler.sendDueReminders();

        verify(historyService).closeIncompleteDaysBefore(configuredToday);
        verify(cardRepository).countDueCards(student.getId(), configuredToday);
        verify(homeworkRepository).countOpenWorksheetsForDay(student.getId(), configuredToday);
        verify(historyService).recordDueSnapshot(student, configuredToday, 2L);
        verify(notificationService).sendDailyTaskReminder(student, 2L, 0L);
    }
}
