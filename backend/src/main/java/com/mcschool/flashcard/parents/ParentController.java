package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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
@RequestMapping("/api/v1")
public class ParentController {

    private final ParentService parentService;

    public ParentController(ParentService parentService) {
        this.parentService = parentService;
    }

    @GetMapping("/parent/children")
    @PreAuthorize("hasRole('PARENT')")
    public List<ParentChildStatusResponse> children(@AuthenticationPrincipal AuthenticatedUser caller) {
        return parentService.children(caller);
    }

    @GetMapping("/parents")
    @PreAuthorize("hasRole('TEACHER')")
    public List<ParentService.ManagedParentResponse> managedParents(
            @AuthenticationPrincipal AuthenticatedUser caller) {
        return parentService.managedParents(caller);
    }

    @PostMapping("/parents")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('TEACHER')")
    public ParentService.ParentCredentialsResponse createParent(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @Valid @RequestBody CreateParentRequest request) {
        return parentService.createParent(caller, request.fullName());
    }

    @PostMapping("/parents/{parentId}/students/{studentId}")
    @PreAuthorize("hasRole('TEACHER')")
    public ParentService.ManagedParentResponse linkStudent(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID parentId,
            @PathVariable UUID studentId) {
        return parentService.linkStudent(caller, parentId, studentId);
    }

    @PostMapping("/parents/{parentId}/reset-password")
    @PreAuthorize("hasRole('TEACHER')")
    public ParentService.ParentCredentialsResponse resetPassword(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID parentId) {
        return parentService.resetParentPassword(caller, parentId);
    }

    public record CreateParentRequest(
            @NotBlank @Size(max = 100) String fullName
    ) {}
}
