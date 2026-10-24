package com.mcschool.flashcard.notebookcamera;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public access is authorized only by a single-use QR or the resulting phone secret. */
@RestController
@RequestMapping("/api/v1/public/notebook-cameras")
public class PublicNotebookCameraController {
    private final NotebookCameraService service;
    public PublicNotebookCameraController(NotebookCameraService service) { this.service = service; }
    public record ClaimRequest(@NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token) {}
    public record SessionRequest(@NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String sessionToken) {}

    @PostMapping("/{cameraId}/claim")
    public NotebookCameraService.PhoneSession claim(@PathVariable UUID cameraId,
                                                    @Valid @RequestBody ClaimRequest body) {
        return service.claim(cameraId, body.token());
    }

    @PostMapping("/{cameraId}/connection")
    public NotebookCameraService.Connection connection(@PathVariable UUID cameraId,
                                                       @Valid @RequestBody SessionRequest body) {
        return service.phoneConnection(cameraId, body.sessionToken());
    }
}
