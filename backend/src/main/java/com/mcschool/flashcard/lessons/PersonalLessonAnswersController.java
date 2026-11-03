package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/lesson-preparations/{eventId}/personal-answers/{studentId}")
@PreAuthorize("hasRole('TEACHER')")
public class PersonalLessonAnswersController {
    private final PersonalLessonAnswersService service;

    public PersonalLessonAnswersController(PersonalLessonAnswersService service) { this.service = service; }

    @GetMapping("/metadata")
    public ResponseEntity<PersonalLessonAnswersService.Metadata> metadata(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable String eventId, @PathVariable UUID studentId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.metadata(teacher, eventId, studentId));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<PersonalLessonAnswersService.Metadata> upload(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable String eventId, @PathVariable UUID studentId, @RequestParam("file") MultipartFile file) throws Exception {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.upload(teacher, eventId, studentId, file.getOriginalFilename(), file.getBytes()));
    }

    @GetMapping
    public ResponseEntity<byte[]> answers(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable String eventId, @PathVariable UUID studentId) {
        return service.answers(teacher, eventId, studentId)
                .map(pdf -> ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"personal-answers.pdf\"")
                        .cacheControl(CacheControl.noStore()).body(pdf))
                .orElseGet(() -> ResponseEntity.notFound().cacheControl(CacheControl.noStore()).build());
    }
}
