package com.mcschool.flashcard.groups;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.dto.AddGroupMembersRequest;
import com.mcschool.flashcard.groups.dto.CreateGroupCardRequest;
import com.mcschool.flashcard.groups.dto.CreateStudentGroupRequest;
import com.mcschool.flashcard.groups.dto.ImportGroupCardsRequest;
import com.mcschool.flashcard.groups.dto.StudentGroupResponse;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/groups")
@PreAuthorize("hasRole('TEACHER')")
public class StudentGroupController {

    private final StudentGroupService groupService;

    public StudentGroupController(StudentGroupService groupService) {
        this.groupService = groupService;
    }

    @GetMapping
    public List<StudentGroupResponse> list(@AuthenticationPrincipal AuthenticatedUser caller) {
        return groupService.list(caller);
    }

    @GetMapping("/{groupId}")
    public StudentGroupResponse get(@AuthenticationPrincipal AuthenticatedUser caller,
                                    @PathVariable UUID groupId) {
        return groupService.get(caller, groupId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public StudentGroupResponse create(@AuthenticationPrincipal AuthenticatedUser caller,
                                       @Valid @RequestBody CreateStudentGroupRequest request) {
        return groupService.create(caller, request);
    }

    @PostMapping("/{groupId}/members")
    public StudentGroupResponse addMembers(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID groupId,
                                           @Valid @RequestBody AddGroupMembersRequest request) {
        return groupService.addMembers(caller, groupId, request);
    }

    @PostMapping("/{groupId}/cards")
    public int createCard(@AuthenticationPrincipal AuthenticatedUser caller,
                          @PathVariable UUID groupId,
                          @Valid @RequestBody CreateGroupCardRequest request) {
        return groupService.createCardForGroup(caller, groupId, request);
    }

    @PostMapping("/{groupId}/cards/import")
    public int importCards(@AuthenticationPrincipal AuthenticatedUser caller,
                           @PathVariable UUID groupId,
                           @Valid @RequestBody ImportGroupCardsRequest request) {
        return groupService.importCardsForGroup(caller, groupId, request);
    }

    @PostMapping(value = "/{groupId}/homeworks/pdf", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public int createPdfHomework(@AuthenticationPrincipal AuthenticatedUser caller,
                                 @PathVariable UUID groupId,
                                 @RequestParam("startDate") LocalDate startDate,
                                 @RequestParam("file") MultipartFile file) {
        return groupService.createPdfHomeworkForGroup(caller, groupId, startDate, file);
    }
}
