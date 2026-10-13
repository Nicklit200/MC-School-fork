package com.mcschool.flashcard.liveclasses;

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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Serves the lesson's workbook PDF to the people in the class. */
@RestController
@RequestMapping("/api/v1/online-classes")
@PreAuthorize("hasAnyRole('TEACHER', 'STUDENT')")
public class OnlineClassDocumentController {

    private final OnlineClassDocumentService documentService;

    public OnlineClassDocumentController(OnlineClassDocumentService documentService) {
        this.documentService = documentService;
    }

    /** 404 when the lesson has no workbook; the board then simply stays blank. */
    @GetMapping("/{classId}/document")
    public ResponseEntity<byte[]> document(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID classId) {
        return documentService.workbook(caller, classId)
                .map(bytes -> ResponseEntity.ok()
                        .contentType(MediaType.APPLICATION_PDF)
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"lesson-workbook.pdf\"")
                        // A lesson document is not for shared caches or the back button.
                        .cacheControl(CacheControl.noStore())
                        .body(bytes))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
