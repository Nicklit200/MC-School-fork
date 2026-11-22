package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Non-expiring in-site PDF preview. Authorization is checked against the
 * logged-in user, assigned teacher and exact lesson for every request.
 * No public sharing links, no signed download tokens, no mutation.
 */
@RestController
@RequestMapping("/api/v1/workbook-drafts")
@PreAuthorize("hasAnyRole('ADMIN', 'TEACHER')")
public class WorkbookDraftStaffPreviewController {
    private final WorkbookDraftDownloadService links;

    public WorkbookDraftStaffPreviewController(WorkbookDraftDownloadService links) {
        this.links = links;
    }

    @GetMapping("/{teacherId}/{draftId}/{kind}")
    public ResponseEntity<byte[]> preview(
            @AuthenticationPrincipal AuthenticatedUser actor,
            @PathVariable UUID teacherId, @PathVariable UUID draftId, @PathVariable String kind) {
        LessonPdfDraftService.PreviewFile file = links.staffPreview(actor, teacherId, draftId, kind);
        String filename = LessonPdfUpload.filename(file.filename(), "Mindcrafti-draft.pdf");
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline().filename(filename, StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .header("Referrer-Policy", "no-referrer")
                .contentLength(file.bytes().length)
                .body(file.bytes());
    }
}
