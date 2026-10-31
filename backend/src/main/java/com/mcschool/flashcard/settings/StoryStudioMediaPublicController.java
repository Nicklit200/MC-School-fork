package com.mcschool.flashcard.settings;

import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/public/stories/media")
public class StoryStudioMediaPublicController {
    private final StoryStudioMediaService media;
    public StoryStudioMediaPublicController(StoryStudioMediaService media) { this.media = media; }

    @GetMapping("/{id}")
    public ResponseEntity<byte[]> download(@PathVariable UUID id,
                                           @RequestParam("expires") long expires,
                                           @RequestParam("sig") String signature) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.IMAGE_PNG)
                .header("X-Content-Type-Options", "nosniff")
                .body(media.validatedDownload(id, expires, signature).bytes());
    }
}
