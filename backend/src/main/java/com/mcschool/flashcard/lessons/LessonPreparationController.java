package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/lesson-preparations")
@PreAuthorize("hasRole('TEACHER')")
public class LessonPreparationController {
    private final LessonPreparationService service;

    public LessonPreparationController(LessonPreparationService service) {
        this.service = service;
    }

    @GetMapping("/{eventId}")
    public LessonPreparationResponse get(@AuthenticationPrincipal AuthenticatedUser teacher,
                                         @PathVariable String eventId) {
        return service.getOrCreate(teacher, eventId);
    }

    @PutMapping("/{eventId}")
    public LessonPreparationResponse update(@AuthenticationPrincipal AuthenticatedUser teacher,
                                            @PathVariable String eventId,
                                            @RequestBody UpdateLessonPreparationRequest request) {
        return service.update(teacher, eventId, request);
    }

    @PostMapping(value = "/{eventId}/workbook", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public LessonPreparationResponse uploadWorkbook(@AuthenticationPrincipal AuthenticatedUser teacher,
                                                    @PathVariable String eventId,
                                                    @RequestParam("file") MultipartFile file) throws Exception {
        return service.uploadWorkbook(teacher, eventId, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/{eventId}/workbook")
    public ResponseEntity<byte[]> workbook(@AuthenticationPrincipal AuthenticatedUser teacher,
                                           @PathVariable String eventId) {
        LessonPreparation preparation = service.require(teacher, eventId);
        if (!preparation.hasWorkbook()) return ResponseEntity.notFound().build();
        String filename = preparation.getWorkbookFilename() == null ? "lesson-workbook.pdf" : preparation.getWorkbookFilename();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + filename.replace("\"", "") + "\"")
                .body(preparation.getWorkbookPdf());
    }
}
