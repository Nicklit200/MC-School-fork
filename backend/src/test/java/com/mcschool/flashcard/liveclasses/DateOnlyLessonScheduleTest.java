package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class DateOnlyLessonScheduleTest {
    private GroupLessonResponse lesson(String eventId, String start) {
        Instant begins = Instant.parse(start);
        return new GroupLessonResponse(eventId, eventId, null, null, null, null,
                List.of(), "Lesson", begins, begins.plusSeconds(2700), null, null);
    }

    @Test
    void nativeRoomCanBeJoinedDuringTheSelectedDayRatherThanOnlyAfterMidnight() {
        var lesson = lesson("local-date-lesson", "2026-10-21T22:00:00Z");
        assertThat(DateOnlyLessonSchedule.onlineClassEnd(lesson)).isEqualTo(Instant.parse("2026-10-22T22:00:00Z"));
        assertThat(lesson.endsAt()).isEqualTo(Instant.parse("2026-10-21T22:45:00Z"));
    }

    @Test
    void handlesTheTwentyFiveHourDayAtTheEndOfDaylightSavingTime() {
        var lesson = lesson("local-dst", "2026-10-24T22:00:00Z");
        assertThat(DateOnlyLessonSchedule.onlineClassEnd(lesson)).isEqualTo(Instant.parse("2026-10-25T23:00:00Z"));
    }

    @Test
    void importedCalendarLessonsKeepTheirScheduledEnd() {
        var lesson = lesson("google-event", "2026-10-22T12:00:00Z");
        assertThat(DateOnlyLessonSchedule.onlineClassEnd(lesson)).isEqualTo(lesson.endsAt());
    }
}
