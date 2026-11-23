package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.LocalTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class AiLessonPilotSchedulerTest {

    @Test
    void morningWorkbookModeTriggersHomeworkAnalysisAtNineEvenIfIndependentPilotDisabled() {
        LocalTime teacherTime = LocalTime.of(10, 0);
        assertThat(AiLessonPilotScheduler.shouldPrepare(false, true, false,
                teacherTime, LocalTime.of(8, 59))).isFalse();
        assertThat(AiLessonPilotScheduler.shouldPrepare(false, true, false,
                teacherTime, LocalTime.of(9, 0))).isTrue();
        assertThat(AiLessonPilotScheduler.shouldPrepare(false, true, false,
                teacherTime, LocalTime.of(11, 30))).isTrue();
    }

    @Test
    void oldPilotStillHonorsIndividualEnablementAndConfiguredTime() {
        LocalTime ten = LocalTime.of(10, 0);
        assertThat(AiLessonPilotScheduler.shouldPrepare(true, false, true,
                ten, LocalTime.of(9, 59))).isFalse();
        assertThat(AiLessonPilotScheduler.shouldPrepare(true, false, true,
                ten, LocalTime.of(10, 0))).isTrue();
        assertThat(AiLessonPilotScheduler.shouldPrepare(true, false, false,
                ten, LocalTime.of(12, 0))).isFalse();
        assertThat(AiLessonPilotScheduler.shouldPrepare(false, false, true,
                ten, LocalTime.of(11, 0))).isFalse();
    }

    @Test
    void existingManuallyPreparedLessonIsNotOverwrittenByMorningScheduler() {
        User teacher = User.activeTeacher("Tester", "teacher@test.local", "teacher", "unused");
        LessonPreparationRepository repo = mock(LessonPreparationRepository.class);
        LessonPreparation prepared = LessonPreparation.create(teacher, "lesson-test");
        prepared.updateNotes("Соня: задано 5, сдано 3, ещё не сдано 2.",
                "{\"kind\":\"homework_errors_v1\",\"issues\":[]}", "План", null);
        when(repo.findByTeacherIdAndEventId(teacher.getId(), "lesson-test"))
                .thenReturn(Optional.of(prepared));
        AiLessonPilotScheduler scheduler = new AiLessonPilotScheduler(
                mock(UserRepository.class), mock(GoogleCalendarLessonService.class),
                repo, mock(AiLessonPilotService.class),
                mock(PushSubscriptionRepository.class), mock(WebPushService.class));
        try {
            assertThat(scheduler.alreadyPrepared(teacher, "lesson-test")).isTrue();
            prepared.updateNotes("Соня: задано 5, сдано 3, ещё не сдано 2.", null, "План", null);
            assertThat(scheduler.alreadyPrepared(teacher, "lesson-test")).isFalse();
        } finally {
            scheduler.close();
        }
    }
}
