package com.mcschool.flashcard.homeworks;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Only a valid, unexpired, resource-specific signature authorizes these read-only endpoints. */
@RestController
@RequestMapping("/api/v1/public/homework-files")
public class HomeworkPublicFileController {

    private final HomeworkFileLinkService fileLinks;

    public HomeworkPublicFileController(HomeworkFileLinkService fileLinks) {
        this.fileLinks = fileLinks;
    }

    @GetMapping(value = "/{homeworkId}/submission.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> submission(@PathVariable UUID homeworkId,
            @RequestParam long expires, @RequestParam String revision, @RequestParam String signature) {
        return response(fileLinks.download(homeworkId, HomeworkFileLinkService.Kind.SUBMISSION,
                expires, revision, signature));
    }

    @GetMapping(value = "/{homeworkId}/worksheet.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> worksheet(@PathVariable UUID homeworkId,
            @RequestParam long expires, @RequestParam String revision, @RequestParam String signature) {
        return response(fileLinks.download(homeworkId, HomeworkFileLinkService.Kind.WORKSHEET,
                expires, revision, signature));
    }

    private ResponseEntity<byte[]> response(HomeworkFileLinkService.Download file) {
        String filename = file.filename().replaceAll("[\\r\\n\\x00-\\x1F\\x7F]", "_")
                .replace('/', '_').replace('\\', '_');
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(file.bytes().length)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(filename, StandardCharsets.UTF_8).build().toString())
                .header("Referrer-Policy", "no-referrer")
                .header("X-Content-Type-Options", "nosniff")
                .header("X-Robots-Tag", "noindex, noarchive, nosnippet")
                .body(file.bytes());
    }
}
