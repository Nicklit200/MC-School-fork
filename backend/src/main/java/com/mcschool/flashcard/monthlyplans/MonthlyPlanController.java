package com.mcschool.flashcard.monthlyplans;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.monthlyplans.dto.MonthlyPlanResponse;
import com.mcschool.flashcard.monthlyplans.dto.UpdateMonthlyPlanRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/monthly-plans")
@PreAuthorize("hasRole('TEACHER')")
public class MonthlyPlanController {
    private final MonthlyPlanService service;

    public MonthlyPlanController(MonthlyPlanService service) {
        this.service = service;
    }

    @GetMapping("/{targetType}/{targetId}")
    public MonthlyPlanResponse get(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String targetType,
            @PathVariable UUID targetId,
            @RequestParam String month) {
        return service.get(caller, targetType, targetId, month);
    }

    @PutMapping("/{targetType}/{targetId}")
    public MonthlyPlanResponse save(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String targetType,
            @PathVariable UUID targetId,
            @RequestParam String month,
            @Valid @RequestBody UpdateMonthlyPlanRequest request) {
        return service.save(caller, targetType, targetId, month, request.planJson());
    }

    @PostMapping(value = "/{targetType}/{targetId}/document", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public MonthlyPlanResponse uploadDocument(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String targetType,
            @PathVariable UUID targetId,
            @RequestParam String month,
            @RequestPart("file") MultipartFile file) {
        return service.uploadDocument(caller, targetType, targetId, month, file);
    }

    @GetMapping("/{targetType}/{targetId}/document")
    public ResponseEntity<byte[]> downloadDocument(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable String targetType,
            @PathVariable UUID targetId,
            @RequestParam String month) {
        MonthlyPlan plan = service.getPlanWithDocument(caller, targetType, targetId, month);
        MediaType mediaType;
        try {
            mediaType = plan.getDocumentContentType() == null
                    ? MediaType.APPLICATION_OCTET_STREAM
                    : MediaType.parseMediaType(plan.getDocumentContentType());
        } catch (RuntimeException ex) {
            mediaType = MediaType.APPLICATION_OCTET_STREAM;
        }
        String filename = plan.getDocumentFilename() == null ? "monthly-plan" : plan.getDocumentFilename();
        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + java.net.URLEncoder.encode(filename, java.nio.charset.StandardCharsets.UTF_8))
                .body(plan.getDocumentData());
    }
}
