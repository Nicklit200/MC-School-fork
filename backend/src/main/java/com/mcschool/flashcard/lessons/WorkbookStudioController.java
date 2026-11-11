package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Private browser editor. Rendering never creates or publishes a lesson draft. */
@RestController
@RequestMapping("/api/v1/admin/workbook-studio")
@PreAuthorize("hasRole('ADMIN')")
public class WorkbookStudioController {
    private final WorkbookStudioProjectService projects;
    private final OwnerWorkbookPdfRenderService renderer;

    public WorkbookStudioController(WorkbookStudioProjectService projects,
                                    OwnerWorkbookPdfRenderService renderer) {
        this.projects = projects;
        this.renderer = renderer;
    }

    public record SaveRequest(@Min(0) long expectedVersion,
                              @NotBlank @Size(max = WorkbookStudioProjectService.MAX_PROJECT_CHARS)
                              String projectJson) {}

    public record RenderRequest(@NotBlank @Size(max = WorkbookStudioProjectService.MAX_LESSON_CHARS)
                                String lessonJson) {}

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@AuthenticationPrincipal AuthenticatedUser caller) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(projects.get(caller));
    }

    @GetMapping("/example")
    public ResponseEntity<Map<String, Object>> example(
            @AuthenticationPrincipal AuthenticatedUser caller) throws IOException {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(projects.example(caller));
    }

    @PutMapping
    public ResponseEntity<Map<String, Object>> save(@AuthenticationPrincipal AuthenticatedUser caller,
                                                     @Valid @RequestBody SaveRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(projects.save(caller, request.expectedVersion(), request.projectJson()));
    }

    @PostMapping("/render")
    public ResponseEntity<Map<String, Object>> render(@AuthenticationPrincipal AuthenticatedUser caller,
                                                       @Valid @RequestBody RenderRequest request) throws Exception {
        // Must be checked before invoking an expensive renderer. No API key can use this endpoint.
        projects.requireOwner(caller);
        var pdfs = renderer.renderStudio(request.lessonJson());
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("studentPdfBase64", Base64.getEncoder().encodeToString(pdfs.studentPdf()));
        answer.put("teacherPdfBase64", Base64.getEncoder().encodeToString(pdfs.teacherPdf()));
        answer.put("studentPages", pdfs.studentPages());
        answer.put("teacherPages", pdfs.teacherPages());
        answer.put("qa", pdfs.qa());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(answer);
    }
}
