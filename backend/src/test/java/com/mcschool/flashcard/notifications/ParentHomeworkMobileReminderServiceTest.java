package com.mcschool.flashcard.notifications;

import static org.junit.jupiter.api.Assertions.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.junit.jupiter.api.Test;

class ParentHomeworkMobileReminderServiceTest {
    private static final ZoneId BERLIN=ZoneId.of("Europe/Berlin");
    private final LocalDate friday=LocalDate.of(2026,11,27);

    private ZonedDateTime time(LocalDate date,int hour,int min) {
        return date.atTime(hour,min).atZone(BERLIN);
    }

    @Test void eveningOnlyAfterSevenPmOnAssignmentDate() {
        assertFalse(ParentHomeworkMobileReminderService.withinWindow("EVENING",friday,time(friday,18,59)));
        assertTrue(ParentHomeworkMobileReminderService.withinWindow("EVENING",friday,time(friday,19,0)));
        assertTrue(ParentHomeworkMobileReminderService.withinWindow("EVENING",friday,time(friday,23,59)));
        assertFalse(ParentHomeworkMobileReminderService.withinWindow("EVENING",friday,time(friday.plusDays(1),0,0)));
    }

    @Test void missedHomeworkAppearsNextMorningButNotAtMidnight() {
        assertFalse(ParentHomeworkMobileReminderService.withinWindow("MORNING_MISSED",
                friday,time(friday.plusDays(1),8,59)));
        assertTrue(ParentHomeworkMobileReminderService.withinWindow("MORNING_MISSED",
                friday,time(friday.plusDays(1),9,0)));
        assertFalse(ParentHomeworkMobileReminderService.withinWindow("MORNING_MISSED",
                friday,time(friday.plusDays(1),13,0)));
        assertFalse(ParentHomeworkMobileReminderService.withinWindow("MORNING_MISSED",
                friday,time(friday.plusDays(2),9,0)));
    }

    @Test void messagesDistinguishOpenAndTrulyMissedHomework() {
        assertTrue(ParentHomeworkMobileReminderService.body("Ученик",1,false,false)
                .contains("сегодняшняя"));
        assertTrue(ParentHomeworkMobileReminderService.body("Ученик",1,true,false)
                .contains("пропущенная"));
        assertTrue(ParentHomeworkMobileReminderService.body("Kind",1,true,true)
                .contains("versäumt"));
    }

    @Test void calendarDaysRespectBerlinDst() {
        LocalDate change=LocalDate.of(2026,10,24);
        assertTrue(ParentHomeworkMobileReminderService.withinWindow("MORNING_MISSED",
                change,time(change.plusDays(1),9,0)));
        assertFalse(ParentHomeworkMobileReminderService.withinWindow("MORNING_MISSED",
                change,time(change.plusDays(1),8,59)));
    }
}
