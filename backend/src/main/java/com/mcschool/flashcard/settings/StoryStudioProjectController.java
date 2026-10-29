package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The actual HTML/CSS/JSON editor. This endpoint does not use or replace the PPTX master. */
@RestController
@RequestMapping("/api/v1/admin/stories/studio")
@PreAuthorize("hasRole('ADMIN')")
public class StoryStudioProjectController {
    private final StoryStudioProjectService service;

    public StoryStudioProjectController(StoryStudioProjectService service) { this.service = service; }

    public record SaveRequest(@Min(0) long expectedVersion,
                              @NotBlank @Size(max = StoryStudioProjectService.MAX_CHARS) String projectJson) {}

    @GetMapping("/info")
    public Map<String, Object> info(@AuthenticationPrincipal AuthenticatedUser user) {
        return service.info(user);
    }

    // The UI reads the full document; MCP uses bounded chunks instead.
    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@AuthenticationPrincipal AuthenticatedUser user) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.get(user));
    }

    @PutMapping
    public Map<String, Object> save(@AuthenticationPrincipal AuthenticatedUser user,
                                    @Valid @RequestBody SaveRequest body) {
        return service.save(user, body.expectedVersion(), body.projectJson());
    }

    @GetMapping("/chunk")
    public Map<String, Object> chunk(@AuthenticationPrincipal AuthenticatedUser user,
                                     @RequestParam("version") long version,
                                     @RequestParam("chunkIndex") int chunkIndex) {
        return service.chunk(user, version, chunkIndex);
    }

    @GetMapping("/download")
    public ResponseEntity<byte[]> download(@AuthenticationPrincipal AuthenticatedUser user,
                                           @RequestParam("version") long version) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"Mindcrafti_Stories_Studio.json\"")
                .header("X-Content-Type-Options", "nosniff")
                .body(service.download(user, version));
    }
}
