package com.mcschool.flashcard.settings;

import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/public/story-template")
public class StoryTemplatePublicDownloadController {
    private static final MediaType PPTX = MediaType.parseMediaType(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    private final StoryTemplateDownloadLinkService links;

    public StoryTemplatePublicDownloadController(StoryTemplateDownloadLinkService links) {
        this.links = links;
    }

    @GetMapping("/download")
    public ResponseEntity<byte[]> download(@RequestParam String token) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(PPTX)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename("Mindcrafti_Stories_Master.pptx").build().toString())
                .body(links.validatedDownload(token));
    }
}
