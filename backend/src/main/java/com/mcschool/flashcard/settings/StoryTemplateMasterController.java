package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/admin/stories/master")
@PreAuthorize("hasRole('ADMIN')")
public class StoryTemplateMasterController {
    private static final MediaType PPTX_MEDIA_TYPE = MediaType.parseMediaType(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    private final StoryTemplateMasterService service;

    public StoryTemplateMasterController(StoryTemplateMasterService service) {
        this.service = service;
    }

    @GetMapping
    public Map<String, Object> info(@AuthenticationPrincipal AuthenticatedUser user) {
        return service.info(user);
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(@AuthenticationPrincipal AuthenticatedUser user,
                                       @RequestParam("file") MultipartFile file) throws java.io.IOException {
        return service.upload(user, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/download")
    public ResponseEntity<byte[]> download(@AuthenticationPrincipal AuthenticatedUser user) {
        Map<String, Object> info = service.info(user);
        String filename = String.valueOf(info.get("filename"));
        return ResponseEntity.ok()
                .contentType(PPTX_MEDIA_TYPE)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(filename, StandardCharsets.UTF_8).build().toString())
                .body(service.download(user));
    }
}
