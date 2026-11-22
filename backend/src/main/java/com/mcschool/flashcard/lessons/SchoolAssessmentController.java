package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Teacher-scoped, date-only school exams. No lesson or Google Meet is created. */
@RestController
@RequestMapping("/api/v1/school-assessments")
@PreAuthorize("hasRole('TEACHER')")
public class SchoolAssessmentController {
    private final SchoolAssessmentService service;
    public SchoolAssessmentController(SchoolAssessmentService service) {this.service=service;}
    @GetMapping
    public List<SchoolAssessmentService.Assessment> list(@AuthenticationPrincipal AuthenticatedUser caller) {
        return service.list(caller);
    }
    @GetMapping("/{id}")
    public SchoolAssessmentService.Assessment get(@AuthenticationPrincipal AuthenticatedUser caller,@PathVariable UUID id) {
        return service.get(caller,id);
    }
    @PostMapping
    public SchoolAssessmentService.Assessment create(@AuthenticationPrincipal AuthenticatedUser caller,
            @RequestBody SchoolAssessmentService.Create body) {
        return service.create(caller,body);
    }
    @PutMapping("/{id}")
    public SchoolAssessmentService.Assessment update(@AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID id,@RequestBody SchoolAssessmentService.Update body) {
        return service.update(caller,id,body);
    }
}
