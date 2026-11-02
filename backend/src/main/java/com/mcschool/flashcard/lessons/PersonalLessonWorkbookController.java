package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/lesson-preparations/{eventId}/personal-workbooks")
@PreAuthorize("hasRole('TEACHER')")
public class PersonalLessonWorkbookController {
    private final PersonalLessonWorkbookService service;

    public PersonalLessonWorkbookController(PersonalLessonWorkbookService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<PersonalLessonWorkbookService.PersonalWorkbooksResponse> list(
            @AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable String eventId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.list(teacher, eventId));
    }

    @PostMapping(value = "/{studentId}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public PersonalLessonWorkbookService.PersonalWorkbookResponse upload(
            @AuthenticationPrincipal AuthenticatedUser teacher, @PathVariable String eventId,
            @PathVariable UUID studentId, @RequestParam("file") MultipartFile file) throws Exception {
        return service.upload(teacher, eventId, studentId, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/{studentId}")
    public ResponseEntity<byte[]> workbook(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable String eventId, @PathVariable UUID studentId) {
        return service.workbook(teacher, eventId, studentId)
                .map(pdf -> ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"personal-workbook.pdf\"")
                        .cacheControl(CacheControl.noStore()).body(pdf))
                .orElseGet(() -> ResponseEntity.notFound().cacheControl(CacheControl.noStore()).build());
    }
}
