package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** One website help center backed by the same published articles read by MCH3. */
@RestController
@RequestMapping("/api/v1/teacher-help")
public class TeacherHelpCenterController {
    private final McpTeacherGuideService guide;
    private final TeacherHelpCenterService content;

    public TeacherHelpCenterController(McpTeacherGuideService guide, TeacherHelpCenterService content) {
        this.guide=guide; this.content=content;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public McpTeacherGuideService.Guide published() {return guide.currentGuide();}

    @GetMapping("/admin")
    @PreAuthorize("hasRole('ADMIN')")
    public List<TeacherHelpCenterService.EditorEntry> editor() {return content.editorEntries();}

    @PutMapping("/admin/{id}/draft")
    @PreAuthorize("hasRole('ADMIN')")
    public TeacherHelpCenterService.EditorEntry draft(@PathVariable String id,
                     @RequestBody McpTeacherGuideService.Article article) {
        return content.saveDraft(id,article);
    }

    @PostMapping("/admin/{id}/publish")
    @PreAuthorize("hasRole('ADMIN')")
    public TeacherHelpCenterService.EditorEntry publish(@PathVariable String id) {
        return content.publish(id);
    }

    @GetMapping("/admin/{id}/history")
    @PreAuthorize("hasRole('ADMIN')")
    public List<TeacherHelpCenterService.Revision> history(@PathVariable String id) {
        return content.history(id);
    }

    @PostMapping("/admin/{id}/restore/{revision}")
    @PreAuthorize("hasRole('ADMIN')")
    public TeacherHelpCenterService.EditorEntry restore(@PathVariable String id,
                                                        @PathVariable long revision) {
        return content.restore(id,revision);
    }

    @PostMapping(path="/admin/images/{id}",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ADMIN')")
    public McpTeacherGuideService.GuideImage upload(@PathVariable String id,
        @RequestParam String title,@RequestParam String description,@RequestParam("file") MultipartFile file)
        throws java.io.IOException {
        return content.uploadImage(id,title,description,file.getContentType(),file.getBytes());
    }

    @GetMapping("/images/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public ResponseEntity<byte[]> image(@PathVariable String id) throws java.io.IOException {
        var stored=guide.imageContent(id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(stored.mimeType()))
            .header(HttpHeaders.CACHE_CONTROL,"private, max-age=300")
            .body(stored.bytes());
    }
}
