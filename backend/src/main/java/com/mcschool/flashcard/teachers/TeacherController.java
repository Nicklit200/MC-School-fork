package com.mcschool.flashcard.teachers;

import com.mcschool.flashcard.teachers.dto.CreateTeacherRequest;
import com.mcschool.flashcard.teachers.dto.TeacherInvitationResponse;
import com.mcschool.flashcard.teachers.dto.UpdateTeacherTrialTranscriptFolderRequest;
import com.mcschool.flashcard.users.UserResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Teacher account management for school administrators. */
@RestController
@RequestMapping("/api/v1/teachers")
@PreAuthorize("hasRole('ADMIN')")
public class TeacherController {

    private final TeacherService teacherService;

    public TeacherController(TeacherService teacherService) {
        this.teacherService = teacherService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TeacherInvitationResponse createTeacher(@Valid @RequestBody CreateTeacherRequest request) {
        return teacherService.createTeacher(request);
    }

    @GetMapping
    public List<UserResponse> listTeachers() {
        return teacherService.listTeachers();
    }

    @PutMapping("/{teacherId}/trial-transcript-drive-folder")
    public UserResponse updateTrialTranscriptFolder(@PathVariable UUID teacherId,
                                                    @RequestBody UpdateTeacherTrialTranscriptFolderRequest request) {
        return teacherService.updateTrialTranscriptFolder(teacherId, request);
    }
}
