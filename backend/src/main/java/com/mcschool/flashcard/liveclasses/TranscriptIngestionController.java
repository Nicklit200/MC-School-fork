package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentRequest;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Internal transcript ingestion, called only by the transcription worker.
 *
 * <p>Authenticated by a narrow shared secret rather than an end-user JWT: the
 * worker acts for no user. The token authorizes this operation and nothing else.
 *
 * <p>Transcript bodies are never logged.
 */
@RestController
@RequestMapping("/api/v1/internal/online-classes")
public class TranscriptIngestionController {

    private static final Logger log = LoggerFactory.getLogger(TranscriptIngestionController.class);

    private final InternalWorkerAuth workerAuth;
    private final OnlineClassTranscriptService transcriptService;

    public TranscriptIngestionController(InternalWorkerAuth workerAuth,
                                         OnlineClassTranscriptService transcriptService) {
        this.workerAuth = workerAuth;
        this.transcriptService = transcriptService;
    }

    @PostMapping("/{classId}/transcript-segments")
    public ResponseEntity<TranscriptSegmentResponse> ingest(
            @PathVariable UUID classId,
            @RequestHeader(value = "X-Internal-Token", required = false) String token,
            @Valid @RequestBody TranscriptSegmentRequest request) {

        if (!workerAuth.matches(token)) {
            log.warn("Rejected an unauthenticated transcript ingestion attempt");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(transcriptService.ingest(classId, request));
    }
}
