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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/lessons")
@PreAuthorize("hasRole('TEACHER')")
public class GroupLessonController {

    private final GoogleCalendarLessonService lessonService;
    private final LessonPreparationService preparationService;
    private final ManualLessonService manualLessonService;

    public GroupLessonController(GoogleCalendarLessonService lessonService,
                                 LessonPreparationService preparationService,
                                 ManualLessonService manualLessonService) {
        this.lessonService = lessonService;
        this.preparationService = preparationService;
        this.manualLessonService = manualLessonService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GroupLessonResponse createLesson(@AuthenticationPrincipal AuthenticatedUser caller,
                                            @Valid @RequestBody CreateLessonRequest request) {
        return manualLessonService.create(caller, request);
    }

    @PostMapping("/series")
    @ResponseStatus(HttpStatus.CREATED)
    public List<GroupLessonResponse> createSeries(@AuthenticationPrincipal AuthenticatedUser caller,
                                                  @Valid @RequestBody CreateLessonSeriesRequest request) {
        return manualLessonService.createSeries(caller, request);
    }

    @GetMapping("/groups")
    public List<GroupLessonResponse> listGroupLessons(@AuthenticationPrincipal AuthenticatedUser caller) {
        return lessonService.listGroupLessons(caller);
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
