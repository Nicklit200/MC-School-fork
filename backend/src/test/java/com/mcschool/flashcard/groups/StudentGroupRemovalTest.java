package com.mcschool.flashcard.groups;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.HomeworkPdfService;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.lessons.GoogleCalendarLessonBindingRepository;
import com.mcschool.flashcard.lessons.LessonHistoryRepository;
import com.mcschool.flashcard.notifications.CardPushNotificationService;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class StudentGroupRemovalTest {
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final GoogleCalendarLessonBindingRepository bindings = mock(GoogleCalendarLessonBindingRepository.class);
    private final LessonHistoryRepository lessons = mock(LessonHistoryRepository.class);
    private final StudentGroupService service = new StudentGroupService(
            groups, members, mock(UserRepository.class), mock(HomeworkRepository.class),
            mock(CardRepository.class), mock(NotificationService.class),
            mock(CardPushNotificationService.class), mock(HomeworkPdfService.class),
            null, bindings, lessons);
    private final UUID teacherId = UUID.randomUUID();
    private final UUID groupId = UUID.randomUUID();
    private final AuthenticatedUser teacher = new AuthenticatedUser(teacherId, "teacher@example.test", Role.TEACHER);
    private final StudentGroup group = mock(StudentGroup.class);

    @BeforeEach
    void setup() {
        when(groups.findByIdAndTeacherIdAndArchivedAtIsNull(groupId, teacherId)).thenReturn(Optional.of(group));
        when(bindings.findAllByGroupId(groupId)).thenReturn(List.of());
    }

    @Test
    void archivesGroupButNeverDeletesStudentHomeworkOrHistory() {
        service.remove(teacher, groupId);
        verify(group).archive(any(Instant.class));
        verify(members).deleteAllByGroupId(groupId);
        verify(groups, never()).delete(any());
        verify(lessons, never()).delete(any());
    }

    @Test
    void cannotRemoveGroupWithUpcomingLesson() {
        when(lessons.existsByGroupIdAndDeletedAtIsNullAndEndsAtAfter(eq(groupId), any(Instant.class)))
                .thenReturn(true);
        assertThrows(ResponseStatusException.class, () -> service.remove(teacher, groupId));
        verify(group, never()).archive(any());
        verify(members, never()).deleteAllByGroupId(any());
    }

    @Test
    void cannotRemoveGroupOwnedByAnotherTeacher() {
        when(groups.findByIdAndTeacherIdAndArchivedAtIsNull(groupId, teacherId))
                .thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> service.remove(teacher, groupId));
        verify(group, never()).archive(any());
    }
}
