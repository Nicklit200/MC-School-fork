package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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

/**
 * Private global workbook design controls. Every write requires the school owner.
 * No requests here change existing lessons, assign homework or call an AI model.
 */
@RestController
@RequestMapping("/api/v1/admin/workbook-generator-layout")
@PreAuthorize("hasRole('ADMIN')")
public class WorkbookGeneratorLayoutController {
    private final WorkbookGeneratorLayoutService layouts;
    private final OwnerWorkbookPdfRenderService renderer;

    public WorkbookGeneratorLayoutController(WorkbookGeneratorLayoutService layouts,
                                             OwnerWorkbookPdfRenderService renderer) {
        this.layouts = layouts;
        this.renderer = renderer;
    }

    public record SaveRequest(@Min(0) long expectedRevision,
                              @NotBlank @Size(max = 1800) String draftJson) {}
    public record TestRequest(@Min(0) long draftRevision,
                              @NotBlank @Size(max = 115000) String lessonJson) {}
    public record ActivateRequest(@Min(0) long draftRevision, @Min(0) long activeRevision) {}
    public record RollbackRequest(@Min(0) long activeRevision) {}

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@AuthenticationPrincipal AuthenticatedUser caller) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(layouts.get(caller));
    }

    @PutMapping("/draft")
    public Map<String, Object> save(@AuthenticationPrincipal AuthenticatedUser caller,
                                    @Valid @RequestBody SaveRequest request) {
        return layouts.saveDraft(caller, request.expectedRevision(), request.draftJson());
    }

    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> test(@AuthenticationPrincipal AuthenticatedUser caller,
                                                     @Valid @RequestBody TestRequest request) throws Exception {
        String profile = layouts.requireDraftForTest(caller, request.draftRevision());
        var result = renderer.renderStudio(request.lessonJson(), profile);
        Map<String, Object> state = layouts.markTested(caller, request.draftRevision(), profile);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("studentPdfBase64", Base64.getEncoder().encodeToString(result.studentPdf()));
        payload.put("teacherPdfBase64", Base64.getEncoder().encodeToString(result.teacherPdf()));
        payload.put("studentPages", result.studentPages());
        payload.put("teacherPages", result.teacherPages());
        payload.put("qa", result.qa());
        payload.put("settings", state);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(payload);
    }

    @PostMapping("/activate")
    public Map<String, Object> activate(@AuthenticationPrincipal AuthenticatedUser caller,
                                        @Valid @RequestBody ActivateRequest request) {
        return layouts.activate(caller, request.draftRevision(), request.activeRevision());
    }

    @PostMapping("/rollback")
    public Map<String, Object> rollback(@AuthenticationPrincipal AuthenticatedUser caller,
                                        @Valid @RequestBody RollbackRequest request) {
        return layouts.rollback(caller, request.activeRevision());
    }
}
