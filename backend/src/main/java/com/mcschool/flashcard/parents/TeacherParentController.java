package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/teacher/parents")
@PreAuthorize("hasRole('TEACHER')")
public class TeacherParentController {

    private final TeacherParentService teacherParentService;

    public TeacherParentController(TeacherParentService teacherParentService) {
        this.teacherParentService = teacherParentService;
    }

    @GetMapping
    public List<ParentAccountResponse> list(@AuthenticationPrincipal AuthenticatedUser caller) {
        return teacherParentService.list(caller);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ParentCredentialsResponse create(@AuthenticationPrincipal AuthenticatedUser caller,
                                            @Valid @RequestBody CreateParentAccountRequest request) {
        return teacherParentService.create(caller, request);
    }

    @PostMapping("/{parentId}/students/{studentId}")
    public ParentAccountResponse linkStudent(@AuthenticationPrincipal AuthenticatedUser caller,
                                             @PathVariable UUID parentId,
                                             @PathVariable UUID studentId) {
        return teacherParentService.linkStudent(caller, parentId, studentId);
    }

    @PostMapping("/{parentId}/reset-password")
    public ParentCredentialsResponse resetPassword(@AuthenticationPrincipal AuthenticatedUser caller,
                                                   @PathVariable UUID parentId) {
        return teacherParentService.resetPassword(caller, parentId);
    }
}
