package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.BindLessonStudentRequest;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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

    public GroupLessonController(GoogleCalendarLessonService lessonService) {
        this.lessonService = lessonService;
    }

    @GetMapping("/groups")
    public List<GroupLessonResponse> listGroupLessons(@AuthenticationPrincipal AuthenticatedUser caller) {
        return lessonService.listGroupLessons(caller);
    }

    @PutMapping("/{bindingKey}/student")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void bindStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                            @PathVariable String bindingKey,
                            @RequestBody BindLessonStudentRequest request) {
        lessonService.bindStudent(caller, bindingKey, request.studentId());
    }
}
