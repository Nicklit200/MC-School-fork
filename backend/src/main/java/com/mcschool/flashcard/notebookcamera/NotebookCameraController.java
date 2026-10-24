package com.mcschool.flashcard.notebookcamera;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/notebook-cameras")
@PreAuthorize("hasAnyRole('TEACHER', 'STUDENT')")
public class NotebookCameraController {
    private final NotebookCameraService service;
    public NotebookCameraController(NotebookCameraService service) { this.service = service; }
    public record PairingRequest(UUID studentId, UUID classId) {}

    @PostMapping("/lessons/{eventId}")
    public NotebookCameraService.Pairing create(@AuthenticationPrincipal AuthenticatedUser caller,
                                                @PathVariable String eventId,
                                                @RequestBody(required = false) PairingRequest body) {
        return service.create(caller, eventId, body == null ? null : body.studentId(),
                body == null ? null : body.classId());
    }

    @GetMapping("/lessons/{eventId}")
    public List<NotebookCameraService.CameraView> list(@AuthenticationPrincipal AuthenticatedUser caller,
                                                       @PathVariable String eventId) {
        return service.list(caller, eventId);
    }

    @PostMapping("/{cameraId}/connection")
    public NotebookCameraService.Connection connection(@AuthenticationPrincipal AuthenticatedUser caller,
                                                        @PathVariable UUID cameraId) {
        return service.viewerConnection(caller, cameraId);
    }

    @DeleteMapping("/{cameraId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@AuthenticationPrincipal AuthenticatedUser caller, @PathVariable UUID cameraId) {
        service.revoke(caller, cameraId);
    }
}
