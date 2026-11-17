package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Offline fake-device regression tests: no real device or parent is notified. */
class PostLessonHomeworkPushServiceTest {
    private final JdbcTemplate db=mock(JdbcTemplate.class);
    private final UserRepository users=mock(UserRepository.class);
    private final PushSubscriptionRepository subscriptions=mock(PushSubscriptionRepository.class);
    private final WebPushService webPush=mock(WebPushService.class);
    private final UUID teacher=UUID.fromString("00000000-0000-4000-a000-000000000031");
    private final UUID admin=UUID.fromString("00000000-0000-4000-a000-000000000032");
    private final UUID pupil=UUID.fromString("00000000-0000-4000-a000-000000000033");
    private final UUID job=UUID.fromString("00000000-0000-4000-a000-000000001050");
    private final UUID subscriptionId=UUID.fromString("00000000-0000-4000-a000-000000000034");
    private final UUID outboxId=UUID.fromString("00000000-0000-4000-a000-000000000035");
    private final Instant finished=Instant.parse("2026-11-17T10:40:00Z");
    private final PostLessonHomeworkPushService service=
            new PostLessonHomeworkPushService(db,users,subscriptions,webPush);

    @BeforeEach void setup() {
        when(webPush.isConfigured()).thenReturn(true);
    }

    @Test void capturesOnlyActiveStaffDeviceSubscriptionsIdempotently() {
        service.captureTerminal(job);
        verify(db).update(argThat(sql -> sql.contains("ON CONFLICT")
                        && sql.contains("push_subscriptions")
                        && sql.contains("u.role = 'ADMIN'")
                        && sql.contains("u.id = j.teacher_id")
                        && sql.contains("u.archived = false")),eq(job));
        verifyNoInteractions(webPush);
    }

    @Test void onlyTeacherAndAdminCanBeNotified() {
        assertTrue(PostLessonHomeworkPushService.isStaffRecipient(teacher,Role.TEACHER,teacher));
        assertTrue(PostLessonHomeworkPushService.isStaffRecipient(admin,Role.ADMIN,teacher));
        assertFalse(PostLessonHomeworkPushService.isStaffRecipient(pupil,Role.STUDENT,teacher));
        assertFalse(PostLessonHomeworkPushService.isStaffRecipient(pupil,Role.PARENT,teacher));
        assertFalse(PostLessonHomeworkPushService.isStaffRecipient(admin,Role.TEACHER,teacher));
    }

    @Test void describesOnlyCommittedAssignmentsAsSuccess() {
        var result=new PostLessonHomeworkPushService.Result("PUBLISHED",finished,teacher,
                "local-test-lesson","Тест | Brueche und Terme",7,21);
        assertTrue(PostLessonHomeworkPushService.title(result).contains("назначена"));
        assertTrue(PostLessonHomeworkPushService.body(result).contains("7 дн., 3 уч."));
    }

    @Test void failureDoesNotMisrepresentAssignmentAsComplete() {
        var result=new PostLessonHomeworkPushService.Result("FAILED",finished,teacher,
                "local-test-lesson","Тест | Brueche und Terme",7,6);
        assertTrue(PostLessonHomeworkPushService.title(result).contains("ошибка"));
        assertTrue(PostLessonHomeworkPushService.body(result).contains("не завершено"));
        assertFalse(PostLessonHomeworkPushService.body(result).contains("назначена"));
    }

    @Test void sendsOnlyAfterMatchingTerminalStatusToCurrentDeviceOwner() {
        prepare("PUBLISHED",Role.TEACHER,teacher);
        service.sendPending();
        verify(webPush,times(1)).send(any(PushSubscription.class),
                contains("назначена"),contains("3 дн., 1 уч."),
                eq("/teacher/lessons/local-test-lesson"),
                eq("post-homework-" + job + "-PUBLISHED"));
        verify(db).update(argThat(sql->sql.contains("SET status = ?")),
                eq("SENT"),eq("SENT"),eq(outboxId));
    }

    @Test void doesNotSendOldFailureAfterTeacherHasRetried() {
        prepare("QUEUED",Role.TEACHER,teacher);
        service.sendPending();
        verify(webPush,never()).send(any(),anyString(),anyString(),anyString(),anyString());
        verify(db).update(argThat(sql->sql.contains("SET status = ?")),
                eq("SKIPPED"),eq("SKIPPED"),eq(outboxId));
    }

    @Test void neverSendsStudentOrParentCompletionPush() {
        prepare("PUBLISHED",Role.PARENT,pupil);
        service.sendPending();
        verify(webPush,never()).send(any(),anyString(),anyString(),anyString());
    }

    @SuppressWarnings({"unchecked","rawtypes"})
    private void prepare(String state,Role role,UUID recipient) {
        var delivery=new PostLessonHomeworkPushService.Delivery(
                outboxId,job,recipient,subscriptionId,"PUBLISHED",finished,1);
        var result=new PostLessonHomeworkPushService.Result(
                state,finished,teacher,"local-test-lesson",
                "Test 2 | Brueche und Terme",3,3);
        when(db.query(anyString(),any(RowMapper.class))).thenAnswer(invocation -> {
            String sql=invocation.getArgument(0,String.class);
            if(sql.contains("SELECT id FROM post_lesson_homework_jobs")) return List.of();
            if(sql.contains("RETURNING id, job_id")) return List.of(delivery);
            if(sql.contains("SELECT state, finished_at")) return List.of(result);
            return List.of();
        });
        // Result lookup includes a jobId SQL bind, unlike the two-argument claim query.
        when(db.query(org.mockito.ArgumentMatchers.<String>argThat(
                sql -> sql.contains("SELECT state, finished_at")),
                any(RowMapper.class), eq(job))).thenReturn(List.of(result));
        // First claim returns a pending device; subsequent claims are empty.
        final int[] claims={0};
        when(db.query(org.mockito.ArgumentMatchers.<String>argThat(sql -> sql.contains("RETURNING id, job_id")),
                any(RowMapper.class))).thenAnswer(invocation -> {
            return claims[0]++ == 0 ? List.of(delivery) : List.of();
        });
        User account=mock(User.class);
        when(account.getId()).thenReturn(recipient);
        when(account.getRole()).thenReturn(role);
        when(account.getStatus()).thenReturn(UserStatus.ACTIVE);
        when(users.findById(recipient)).thenReturn(java.util.Optional.of(account));
        PushSubscription device=mock(PushSubscription.class);
        when(device.getUser()).thenReturn(account);
        when(subscriptions.findById(subscriptionId)).thenReturn(java.util.Optional.of(device));
    }
}
