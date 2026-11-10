package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Private, authenticated browser incident categories, never raw logs or free-form text. */
@RestController
@RequestMapping("/api/v1/online-classes/{classId}/kolyn/diagnostics")
@PreAuthorize("hasAnyRole('TEACHER','STUDENT')")
public class KolinClassDiagnosticsController {
    public record Report(@NotBlank @Pattern(regexp =
        "MEDIA_AUTHORIZATION|MEDIA_SIGNALING|MEDIA_NETWORK|MEDIA_DEVICES|MEDIA_UNKNOWN|" +
        "CONNECTION_LOST|PDF_RENDER|TRANSCRIPTION_START|AUDIO_FOCUS") String category) {}
    private final KolinClassDiagnosticsService diagnostics;
    public KolinClassDiagnosticsController(KolinClassDiagnosticsService diagnostics) {
        this.diagnostics = diagnostics;
    }
    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(@AuthenticationPrincipal AuthenticatedUser caller,
                       @PathVariable UUID classId, @Valid @RequestBody Report body) {
        diagnostics.report(caller, classId, body.category());
    }
}
