package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/online-classes/{classId}/audio-focus")
@PreAuthorize("hasRole('TEACHER')")
public class OnlineClassAudioFocusController {
    private final OnlineClassAudioFocusService service;

    public OnlineClassAudioFocusController(OnlineClassAudioFocusService service) {
        this.service = service;
    }

    @PutMapping
    public OnlineClassAudioFocusService.Focus update(@AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId, @RequestBody OnlineClassAudioFocusService.Request request) {
        return service.update(caller, classId, request);
    }
}
