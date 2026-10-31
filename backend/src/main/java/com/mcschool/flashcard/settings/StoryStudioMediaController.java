package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin/stories/media")
@PreAuthorize("hasRole('ADMIN')")
public class StoryStudioMediaController {
    private final StoryStudioMediaService media;
    public StoryStudioMediaController(StoryStudioMediaService media) { this.media = media; }

    public record UploadRequest(@Min(1) long studioVersion,
                                @Min(1) @Max(3) int storyNumber,
                                @NotBlank @Size(max = StoryStudioMediaService.MAX_BASE64_CHARS) String imageBase64) {}

    @PostMapping
    public Map<String, Object> upload(@AuthenticationPrincipal AuthenticatedUser user,
                                      @Valid @RequestBody UploadRequest body) {
        return media.upload(user, body.studioVersion(), body.storyNumber(), body.imageBase64());
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal AuthenticatedUser user,
                                                    @RequestParam("studioVersion") long studioVersion) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(media.list(user, studioVersion));
    }
}
