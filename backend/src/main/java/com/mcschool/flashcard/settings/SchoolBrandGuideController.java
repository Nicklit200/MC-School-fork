package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/school-prompts/brand-guide")
public class SchoolBrandGuideController {

    private final SchoolBrandGuideService service;

    public SchoolBrandGuideController(SchoolBrandGuideService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public SchoolBrandGuideResponse get(@AuthenticationPrincipal AuthenticatedUser caller) {
        return service.readForStaff(caller);
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public SchoolBrandGuideResponse update(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @RequestBody UpdateSchoolBrandGuideRequest request) {
        return service.update(caller, request);
    }

    @GetMapping("/pdf")
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public ResponseEntity<byte[]> pdf(@AuthenticationPrincipal AuthenticatedUser caller) {
        SchoolBrandGuideService.BrandGuidePdf pdf = service.pdfForStaff(caller);
        ContentDisposition disposition = ContentDisposition.inline()
                .filename(pdf.filename(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(pdf.bytes());
    }
}
