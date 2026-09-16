package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
public class ParentTeacherMessageController {

    private final ParentTeacherMessageService messageService;

    public ParentTeacherMessageController(ParentTeacherMessageService messageService) {
        this.messageService = messageService;
    }

    @GetMapping("/students/{studentId}/messages")
    @PreAuthorize("hasAnyRole('PARENT','TEACHER','ADMIN')")
    public List<ParentTeacherMessageService.MessageResponse> list(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID studentId) {
        return messageService.list(caller, studentId);
    }

    @PostMapping(value = "/students/{studentId}/messages", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('PARENT','TEACHER','ADMIN')")
    public ParentTeacherMessageService.MessageResponse send(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID studentId,
            @RequestParam(value = "text", required = false) String text,
            @RequestParam(value = "image", required = false) MultipartFile image) {
        return messageService.send(caller, studentId, text, image);
    }

    @GetMapping("/messages/{messageId}/image")
    @PreAuthorize("hasAnyRole('PARENT','TEACHER','ADMIN')")
    public ResponseEntity<byte[]> image(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID messageId) {
        ParentTeacherMessageService.ImageResponse image = messageService.image(caller, messageId);
        ContentDisposition disposition = ContentDisposition.inline()
                .filename(image.filename(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
                .contentType(MediaType.parseMediaType(image.mimeType()))
                .contentLength(image.bytes().length)
                .body(image.bytes());
    }
}
