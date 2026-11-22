package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * MCH3 bridge delegates to the same revisioned calendar used in the board.
 * It does not invent a separate data store or modify pupil mastery.
 */
class SchoolCalendarControllerTest {
    @Test
    void sameCalendarServiceForReadAndWrite() {
        SchoolCalendarService calendars=mock(SchoolCalendarService.class);
        SchoolCalendarController endpoint=new SchoolCalendarController(calendars);
        var existing=Map.<String,Object>of("boardRevision",4,"available",false);
        when(calendars.get("grade-6","GESAMTSCHULE","allgemein",11)).thenReturn(existing);
        assertSame(existing,endpoint.get("grade-6","GESAMTSCHULE","allgemein",11));
        verify(calendars).get("grade-6","GESAMTSCHULE","allgemein",11);

        UUID adminId=UUID.randomUUID();
        AuthenticatedUser admin=mock(AuthenticatedUser.class);
        when(admin.id()).thenReturn(adminId);
        var draft=new SchoolCalendarController.CalendarWrite("GESAMTSCHULE","allgemein",4,
            "{\"version\":1,\"schoolType\":\"GESAMTSCHULE\",\"grade\":6,\"profile\":\"allgemein\"}");
        var saved=Map.<String,Object>of("saved",true,"boardRevision",5);
        when(calendars.put("grade-6","GESAMTSCHULE","allgemein",4,draft.calendarJson(),adminId))
            .thenReturn(saved);
        assertSame(saved,endpoint.upsert("grade-6",draft,admin));
    }

    @Test
    void adminOnlyMutationAndReaderAuthorization() throws Exception {
        var classAuth=SchoolCalendarController.class.getAnnotation(PreAuthorize.class);
        assertNotNull(classAuth);
        assertTrue(classAuth.value().contains("ADMIN"));
        assertTrue(classAuth.value().contains("TEACHER"));
        var put=SchoolCalendarController.class.getMethod("upsert",String.class,
            SchoolCalendarController.CalendarWrite.class,AuthenticatedUser.class);
        assertNotNull(put.getAnnotation(PutMapping.class));
        assertEquals("hasRole('ADMIN')",put.getAnnotation(PreAuthorize.class).value());
        assertNotNull(SchoolCalendarController.class
            .getMethod("get",String.class,String.class,String.class,Integer.class)
            .getAnnotation(GetMapping.class));
    }
}
