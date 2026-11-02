package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import com.mcschool.flashcard.users.User;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LessonEntryPolicyTest {
    private static final Instant DAY = Instant.parse("2026-10-24T10:00:00Z");
    private OnlineClass room(Instant start) {
        User teacher = mock(User.class);
        when(teacher.getId()).thenReturn(UUID.randomUUID());
        OnlineClass room = OnlineClass.forStudent(teacher, "event", "binding", "Maths",
                start, start.plusSeconds(3600), mock(User.class));
        room.start(start); return room;
    }
    private OnlineClassParticipant returning(OnlineClass room) {
        OnlineClassParticipant p = OnlineClassParticipant.student(room, mock(User.class));
        p.admit(); p.markJoined(room.getScheduledStartAt()); return p;
    }
    @Test void berlinDayIsHalfOpenAtBothMidnights() {
        assertThat(LessonEntryPolicy.dayStart(DAY)).isEqualTo(Instant.parse("2026-10-23T22:00:00Z"));
        assertThat(LessonEntryPolicy.dayEnd(DAY)).isEqualTo(Instant.parse("2026-10-24T22:00:00Z"));
        assertThat(LessonEntryPolicy.isLessonDay(DAY, LessonEntryPolicy.dayStart(DAY))).isTrue();
        assertThat(LessonEntryPolicy.isLessonDay(DAY, LessonEntryPolicy.dayStart(DAY).minusNanos(1))).isFalse();
        assertThat(LessonEntryPolicy.isLessonDay(DAY, LessonEntryPolicy.dayEnd(DAY).minusNanos(1))).isTrue();
        assertThat(LessonEntryPolicy.isLessonDay(DAY, LessonEntryPolicy.dayEnd(DAY))).isFalse();
    }
    @Test void daylightSavingDaysHave23And25Hours() {
        Instant spring = Instant.parse("2026-03-29T12:00:00Z"), autumn = Instant.parse("2026-10-25T12:00:00Z");
        assertThat(Duration.between(LessonEntryPolicy.dayStart(spring), LessonEntryPolicy.dayEnd(spring))).isEqualTo(Duration.ofHours(23));
        assertThat(Duration.between(LessonEntryPolicy.dayStart(autumn), LessonEntryPolicy.dayEnd(autumn))).isEqualTo(Duration.ofHours(25));
    }
    @Test void openingTimeAndLegacyExtensionsCannotMoveTheLessonDay() {
        OnlineClass room = room(DAY); room.allowStudentJoiningUntil(DAY.plusSeconds(172800));
        assertThat(LessonEntryPolicy.canEnter(room, null, DAY)).isTrue();
        assertThat(LessonEntryPolicy.canEnter(room, null, LessonEntryPolicy.dayEnd(DAY))).isFalse();
        assertThat(LessonEntryPolicy.canEnter(room, null, LessonEntryPolicy.dayStart(DAY).minusSeconds(1))).isFalse();
    }
    @Test void admissionAloneDoesNotGrantAnEntryAfterMidnight() {
        OnlineClass room = room(DAY); OnlineClassParticipant p = OnlineClassParticipant.student(room, mock(User.class)); p.admit();
        assertThat(LessonEntryPolicy.canEnter(room, p, LessonEntryPolicy.dayEnd(DAY))).isFalse();
    }
    @Test void anExistingAdmittedSessionCanReconnectAfterMidnightUntilEnd() {
        OnlineClass room = room(DAY); OnlineClassParticipant p = returning(room); Instant after = LessonEntryPolicy.dayEnd(DAY).plusSeconds(60);
        assertThat(LessonEntryPolicy.canEnter(room, p, after)).isTrue();
        assertThat(LessonEntryPolicy.state(room, p, after)).isEqualTo("RECONNECT");
        room.end(after);
        assertThat(LessonEntryPolicy.canEnter(room, p, after)).isFalse();
        assertThat(LessonEntryPolicy.state(room, p, after)).isEqualTo("ENDED");
    }
    @Test void scheduledAndCancelledRoomsNeverGrantEntry() {
        OnlineClass room = OnlineClass.forStudent(mock(User.class), "event", "binding", "Maths", DAY, DAY.plusSeconds(3600), mock(User.class));
        assertThat(LessonEntryPolicy.state(room, null, DAY)).isEqualTo("WAITING_FOR_TEACHER");
        assertThat(LessonEntryPolicy.canEnter(room, null, DAY)).isFalse();
        room.cancel(); assertThat(LessonEntryPolicy.canEnter(room, null, DAY)).isFalse();
    }
    @Test void theStudentReconnectWindowExpiresWithoutEndingTheLesson() {
        OnlineClass room = room(DAY); room.observeEmpty(DAY.minusSeconds(7200));
        OnlineClassParticipant participant = returning(room);
        assertThat(LessonEntryPolicy.canEnter(room, participant, LessonEntryPolicy.weekEnd(DAY).minusNanos(1))).isTrue();
        assertThat(LessonEntryPolicy.weekExpired(room, LessonEntryPolicy.weekEnd(DAY).minusNanos(1))).isFalse();
        assertThat(LessonEntryPolicy.canEnter(room, participant, LessonEntryPolicy.weekEnd(DAY))).isFalse();
        assertThat(LessonEntryPolicy.state(room, participant, LessonEntryPolicy.weekEnd(DAY))).isEqualTo("DAY_CLOSED");
        assertThat(room.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
    }
    @Test void removedAndRejectedAttendeesCannotUseReconnect() {
        OnlineClass room = room(DAY); OnlineClassParticipant p = returning(room); p.remove();
        assertThat(LessonEntryPolicy.canEnter(room, p, DAY)).isFalse();
        assertThat(LessonEntryPolicy.canEnter(room, p, LessonEntryPolicy.dayEnd(DAY))).isFalse();
        OnlineClassParticipant rejected = returning(room); rejected.reject();
        assertThat(LessonEntryPolicy.canEnter(room, rejected, DAY)).isFalse();
    }
    @Test void tokensExpireAtDayBoundaryForFirstEntryAndMondayForReturning() {
        OnlineClass room = room(DAY); Instant nearEnd = LessonEntryPolicy.dayEnd(DAY).minusSeconds(10);
        assertThat(LessonEntryPolicy.tokenTtl(room, null, nearEnd, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofSeconds(10));
        OnlineClassParticipant p = returning(room);
        assertThat(LessonEntryPolicy.tokenTtl(room, p, nearEnd, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofMinutes(5));
        Instant lastSecond = LessonEntryPolicy.weekEnd(DAY).minusSeconds(10);
        assertThat(LessonEntryPolicy.tokenTtl(room, p, lastSecond, Duration.ofMinutes(5)))
                .isEqualTo(Duration.ofSeconds(10));
    }
    @Test void mondayBoundaryHandlesDaylightSavingAndHostReconnect() {
        Instant sunday = Instant.parse("2026-10-25T12:00:00Z");
        assertThat(LessonEntryPolicy.weekEnd(sunday)).isEqualTo(Instant.parse("2026-10-25T23:00:00Z"));
        assertThat(LessonEntryPolicy.weekEnd(Instant.parse("2026-03-29T12:00:00Z")))
                .isEqualTo(Instant.parse("2026-03-29T22:00:00Z"));
        OnlineClass room = room(DAY);
        OnlineClassParticipant teacher = OnlineClassParticipant.host(room, room.getTeacher());
        assertThat(LessonEntryPolicy.canEnter(room, teacher, LessonEntryPolicy.dayEnd(DAY).plusSeconds(1))).isTrue();
    }

    @Test void theOwningTeacherCanEnterBeforeTheLessonDateAndWeeksAfterIt() {
        OnlineClass room = room(DAY);
        OnlineClassParticipant host = OnlineClassParticipant.host(room, room.getTeacher());
        for (Instant at : new Instant[] {DAY.minusSeconds(86400), DAY.plusSeconds(30 * 86400)}) {
            assertThat(LessonEntryPolicy.canEnter(room, host, at)).isTrue();
            assertThat(LessonEntryPolicy.state(room, host, at)).isEqualTo("RECONNECT");
            assertThat(LessonEntryPolicy.tokenTtl(room, host, at, Duration.ofMinutes(10)))
                    .isEqualTo(Duration.ofMinutes(10));
        }
    }

    @Test void teacherTokensKeepTheirConfiguredLifetimeAcrossMidnightAndMonday() {
        OnlineClass room = room(DAY);
        OnlineClassParticipant host = OnlineClassParticipant.host(room, room.getTeacher());
        for (Instant at : new Instant[] {LessonEntryPolicy.dayEnd(DAY).minusSeconds(1),
                LessonEntryPolicy.weekEnd(DAY).minusSeconds(1), LessonEntryPolicy.weekEnd(DAY)}) {
            assertThat(LessonEntryPolicy.tokenTtl(room, host, at, Duration.ofMinutes(10)))
                    .isEqualTo(Duration.ofMinutes(10));
        }
    }

    @Test void aHostRoleFromAnotherRoomDoesNotGrantTheTeacherExemption() {
        OnlineClass room = room(DAY), anotherRoom = room(DAY);
        OnlineClassParticipant anotherHost = OnlineClassParticipant.host(anotherRoom, anotherRoom.getTeacher());
        OnlineClassParticipant mislabelled = OnlineClassParticipant.host(room, anotherRoom.getTeacher());
        assertThat(LessonEntryPolicy.canEnter(room, anotherHost, DAY.plusSeconds(30 * 86400))).isFalse();
        assertThat(LessonEntryPolicy.canEnter(room, mislabelled, DAY.minusSeconds(86400))).isFalse();
    }

    @Test void explicitEndAndCancellationRemainFinalForTheTeacher() {
        OnlineClass room = room(DAY);
        OnlineClassParticipant host = OnlineClassParticipant.host(room, room.getTeacher());
        room.end(DAY.plusSeconds(3600));
        assertThat(LessonEntryPolicy.canEnter(room, host, DAY.plusSeconds(30 * 86400))).isFalse();
        assertThat(LessonEntryPolicy.state(room, host, DAY)).isEqualTo("ENDED");
        OnlineClass cancelled = OnlineClass.forStudent(room.getTeacher(), "cancelled", "cancelled", "Maths",
                DAY, DAY.plusSeconds(3600), mock(User.class));
        cancelled.cancel();
        assertThat(LessonEntryPolicy.canEnter(cancelled,
                OnlineClassParticipant.host(cancelled, cancelled.getTeacher()), DAY)).isFalse();
    }

    @Test void aLiveRoomWithoutItsTeacherDoesNotAllowAnyStudentEntry() {
        OnlineClass room = room(DAY);
        OnlineClassParticipant participant = returning(room);
        for (Instant at : new Instant[] {DAY, DAY.minusSeconds(86400), DAY.plusSeconds(30 * 86400)}) {
            assertThat(LessonEntryPolicy.canEnter(room, null, at, false, false)).isFalse();
            assertThat(LessonEntryPolicy.canEnter(room, participant, at, false, false)).isFalse();
            assertThat(LessonEntryPolicy.state(room, participant, at, false, false))
                    .isEqualTo("WAITING_FOR_TEACHER");
        }
        assertThat(room.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
    }

    @Test void anActuallyPresentTeacherAllowsFirstStudentEntryOnAnyDate() {
        OnlineClass room = room(DAY);
        Duration configured = Duration.ofMinutes(10);
        for (Instant at : new Instant[] {DAY.minusSeconds(86400), DAY, DAY.plusSeconds(30 * 86400)}) {
            assertThat(LessonEntryPolicy.canEnter(room, null, at, false, true)).isTrue();
            assertThat(LessonEntryPolicy.state(room, null, at, false, true)).isEqualTo("OPEN");
            assertThat(LessonEntryPolicy.state(room, returning(room), at, false, true)).isEqualTo("RECONNECT");
            assertThat(LessonEntryPolicy.tokenTtl(room, null, at, configured, false, true))
                    .isEqualTo(configured).isPositive();
        }
    }

    @Test void teacherPresenceCannotReviveATerminalRoomOrRemovedStudent() {
        OnlineClass room = room(DAY);
        OnlineClassParticipant removed = returning(room); removed.remove();
        OnlineClassParticipant rejected = returning(room); rejected.reject();
        for (OnlineClassParticipant blocked : new OnlineClassParticipant[] {removed, rejected}) {
            for (boolean teacherPresent : new boolean[] {false, true}) {
                assertThat(LessonEntryPolicy.canEnter(room, blocked, DAY, false, teacherPresent)).isFalse();
                assertThat(LessonEntryPolicy.state(room, blocked, DAY, false, teacherPresent)).isEqualTo("CLOSED");
            }
        }
        room.end(DAY.plusSeconds(3600));
        assertThat(LessonEntryPolicy.canEnter(room, null, DAY, false, true)).isFalse();
        assertThat(LessonEntryPolicy.state(room, null, DAY, false, true)).isEqualTo("ENDED");
        OnlineClass cancelled = OnlineClass.forStudent(room.getTeacher(), "cancelled-presence", "cancelled-presence", "Maths",
                DAY, DAY.plusSeconds(3600), mock(User.class));
        cancelled.cancel();
        assertThat(LessonEntryPolicy.canEnter(cancelled, null, DAY, false, true)).isFalse();
        assertThat(LessonEntryPolicy.state(cancelled, null, DAY, false, true)).isEqualTo("ENDED");
    }

    @Test void teacherPresenceCannotOpenAnUnstartedRoomButHostDoesNotNeedSelfPresence() {
        OnlineClass live = room(DAY);
        OnlineClass scheduled = OnlineClass.forStudent(live.getTeacher(), "future", "future", "Maths",
                DAY, DAY.plusSeconds(3600), mock(User.class));
        assertThat(LessonEntryPolicy.canEnter(scheduled, null, DAY, false, true)).isFalse();
        assertThat(LessonEntryPolicy.state(scheduled, null, DAY, false, true)).isEqualTo("WAITING_FOR_TEACHER");
        assertThat(LessonEntryPolicy.canEnter(live, null, DAY.plusSeconds(30 * 86400), true, false)).isTrue();
        assertThat(LessonEntryPolicy.tokenTtl(live, null, DAY.plusSeconds(30 * 86400),
                Duration.ofMinutes(10), true, false)).isEqualTo(Duration.ofMinutes(10));
    }
}
