package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.lessons.ManualLessonService;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import java.time.Instant;
import java.time.ZoneId;

/** Native lessons have a date and duration; the teacher chooses when to open the room. */
final class DateOnlyLessonSchedule {
    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");

    private DateOnlyLessonSchedule() {}

    static Instant onlineClassEnd(GroupLessonResponse lesson) {
        if (!lesson.eventId().startsWith(ManualLessonService.EVENT_PREFIX)) return lesson.endsAt();
        // Keep the room's admission window available for the whole lesson day.
        // The planned duration remains in lesson_history; this is only the join window.
        return lesson.startsAt().atZone(SCHOOL_ZONE).toLocalDate().plusDays(1)
                .atStartOfDay(SCHOOL_ZONE).toInstant();
    }
}
