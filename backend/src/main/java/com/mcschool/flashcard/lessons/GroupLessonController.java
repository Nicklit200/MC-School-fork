package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.CreateLessonRequest;
import com.mcschool.flashcard.lessons.dto.CreateLessonSeriesRequest;
import com.mcschool.flashcard.lessons.dto.BindLessonGroupRequest;
import com.mcschool.flashcard.lessons.dto.BindLessonStudentRequest;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/lessons")
@PreAuthorize("hasRole('TEACHER')")
public class GroupLessonController {

    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationService preparationService;
    private final ManualLessonService manualLessonService;
    private final LessonExecutionSummaryService executionSummaryService;

    public GroupLessonController(GoogleCalendarLessonService lessonService,
                                 LessonPreparationService preparationService,
                                 ManualLessonService manualLessonService,
                                 LessonExecutionSummaryService executionSummaryService) {
        this.lessonService = lessonService;
        this.preparationService = preparationService;
        this.manualLessonService = manualLessonService;
        this.executionSummaryService = executionSummaryService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GroupLessonResponse createLesson(@AuthenticationPrincipal AuthenticatedUser caller,
                                            @Valid @RequestBody CreateLessonRequest request) {
        return manualLessonService.create(caller, request);
    }

    public record UpdateLessonTimeRequest(java.time.Instant startsAt, java.time.Instant endsAt) {}

    @PutMapping("/{eventId}/schedule")
    public GroupLessonResponse updateSchedule(@AuthenticationPrincipal AuthenticatedUser caller,
                                              @PathVariable String eventId,
                                              @RequestBody UpdateLessonTimeRequest request) {
        return manualLessonService.reschedule(caller, eventId, request.startsAt(), request.endsAt());
    }

    @DeleteMapping("/{eventId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteLesson(@AuthenticationPrincipal AuthenticatedUser caller,
                             @PathVariable String eventId) {
        manualLessonService.delete(caller, eventId);
    }

    @PostMapping("/series")
    @ResponseStatus(HttpStatus.CREATED)
    public List<GroupLessonResponse> createSeries(@AuthenticationPrincipal AuthenticatedUser caller,
                                                  @Valid @RequestBody CreateLessonSeriesRequest request) {
        return manualLessonService.createSeries(caller, request);
    }

    @GetMapping("/groups")
    public List<GroupLessonResponse> listGroupLessons(@AuthenticationPrincipal AuthenticatedUser caller,
                                                     @RequestParam(name = "refresh", defaultValue = "true") boolean refresh) {
        List<GroupLessonResponse> lessons = refresh
                ? lessonService.listGroupLessons(caller) : lessonService.listSavedGroupLessons(caller);
        return executionSummaryService.enrichCurrent(caller.id(), lessons);
    }

    @PostMapping("/{eventId}/site-opened")
    public LessonPreparationResponse markSiteOpened(@AuthenticationPrincipal AuthenticatedUser caller,
                                                    @PathVariable String eventId) {
        return preparationService.markSiteOpened(caller, eventId);
    }

    @PutMapping("/{bindingKey}/student")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void bindStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                            @PathVariable String bindingKey,
                            @RequestBody BindLessonStudentRequest request) {
        if (bindingKey.startsWith(ManualLessonService.EVENT_PREFIX)) {
            manualLessonService.bindStudent(caller, bindingKey, request.studentId());
        } else {
            lessonService.bindStudent(caller, bindingKey, request.studentId());
        }
    }

    @PutMapping("/{bindingKey}/group")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void bindGroup(@AuthenticationPrincipal AuthenticatedUser caller,
                          @PathVariable String bindingKey,
                          @RequestBody BindLessonGroupRequest request) {
        if (bindingKey.startsWith(ManualLessonService.EVENT_PREFIX)) {
            manualLessonService.bindGroup(caller, bindingKey, request.groupId());
        } else {
            lessonService.bindGroup(caller, bindingKey, request.groupId());
        }
    }
}
