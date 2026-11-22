package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * Thin, authorized adapter around the same revisioned curriculum calendar used
 * by /skills. MCH3's generic site-function bridge can read and write through
 * this controller without creating any parallel copy of the calendar.
 */
@RestController
@RequestMapping("/api/v1/school-curriculum-calendars")
@PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
public class SchoolCalendarController {
    public record CalendarWrite(String schoolType, String profile,
                                long expectedRevision, String calendarJson) {}

    private final SchoolCalendarService calendars;

    public SchoolCalendarController(SchoolCalendarService calendars) {
        this.calendars = calendars;
    }

    @GetMapping("/{boardId}")
    public Map<String,Object> get(@PathVariable String boardId,
                                  @RequestParam String schoolType,
                                  @RequestParam(required=false) String profile,
                                  @RequestParam(required=false) Integer month) {
        return calendars.get(boardId,schoolType,profile,month);
    }

    @PutMapping("/{boardId}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String,Object> upsert(@PathVariable String boardId,
                                      @RequestBody CalendarWrite body,
                                      @AuthenticationPrincipal AuthenticatedUser caller) {
        if(body==null)throw new org.springframework.web.server.ResponseStatusException(
            org.springframework.http.HttpStatus.BAD_REQUEST,"Укажите календарь");
        return calendars.put(boardId,body.schoolType(),body.profile(),
                             body.expectedRevision(),body.calendarJson(),caller.id());
    }
}
