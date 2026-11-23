package com.mcschool.flashcard.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class ParentNotificationDeliveryTest {
    @Test
    void eveningSchedulerStillAttemptsEmailWhenParentHasNoRegisteredPhone() {
        User teacher = User.activeTeacher("Teacher", "teacher@school.test", "teacher", "hash");
        User parent = User.activeParent("Parent", "parent", "hash", teacher);
        User student = User.managedStudent("Student", teacher);
        student.linkParent(parent);

        UserRepository users = mock(UserRepository.class);
        HomeworkRepository homework = mock(HomeworkRepository.class);
        CardRepository cards = mock(CardRepository.class);
        NotificationService email = mock(NotificationService.class);
        PushSubscriptionRepository devices = mock(PushSubscriptionRepository.class);
        WebPushService push = mock(WebPushService.class);

        when(users.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)).thenReturn(List.of(student));
        when(homework.countOpenWorksheetsForDay(eq(student.getId()), any(LocalDate.class))).thenReturn(1L);
        when(devices.findAllByUserId(parent.getId())).thenReturn(List.of());
        when(push.isConfigured()).thenReturn(true);

        ParentHomeworkNotificationScheduler scheduler = new ParentHomeworkNotificationScheduler(
                users, homework, cards, email, devices, push, "Europe/Berlin");
        scheduler.notifyParents();
        verify(email).sendParentMissedHomework(parent, student, 1L);
        verify(push, never()).send(any(PushSubscription.class), anyString(), anyString(), anyString());
    }

    @Test
    void subscriberStatusUsesCurrentAccountOnlyAndDoesNotExposeEndpoints() {
        User teacher = User.activeTeacher("Teacher", "teacher@school.test", "teacher", "hash");
        User parent = User.activeParent("Parent", "parent", "hash", teacher);
        UserRepository users = mock(UserRepository.class);
        PushSubscriptionRepository subscriptions = mock(PushSubscriptionRepository.class);
        WebPushService webPush = mock(WebPushService.class);
        when(users.findById(parent.getId())).thenReturn(Optional.of(parent));
        when(subscriptions.findAllByUserId(parent.getId())).thenReturn(List.of());
        when(webPush.isConfigured()).thenReturn(true);
        PushController controller = new PushController(subscriptions, users, webPush);
        Map<String, Object> status = controller.status(new AuthenticatedUser(
                parent.getId(), parent.getEmail(), Role.PARENT));
        assertThat(status).containsEntry("registeredDevices", 0)
                .containsEntry("ready", false)
                .containsEntry("emailAvailable", false);
        assertThat(status.keySet()).containsExactlyInAnyOrder(
                "registeredDevices", "ready", "emailAvailable", "enabled");
    }

    @Test
    void administratorCanIdentifyParentAccountsWithoutPushOrLinkedChildren() {
        User teacher = User.activeTeacher("Teacher", "teacher@school.test", "teacher", "hash");
        User parent = User.activeParent("Parent", "parent", "hash", teacher);
        UserRepository users = mock(UserRepository.class);
        PushSubscriptionRepository subscriptions = mock(PushSubscriptionRepository.class);
        when(users.findAdminAccountsByRole(Role.PARENT)).thenReturn(List.of(parent));
        when(users.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.getId())).thenReturn(List.of());
        when(subscriptions.findAllByUserId(parent.getId())).thenReturn(List.of());
        PushController controller = new PushController(subscriptions, users, mock(WebPushService.class));
        List<Map<String, Object>> rows = controller.parentDeliveryReadiness();
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("parentId", parent.getId().toString())
                .containsEntry("registeredDevices", 0)
                .containsEntry("linkedChildren", 0)
                .containsEntry("emailAvailable", false);
        assertThat(rows.get(0)).doesNotContainKey("email");
    }
}
