package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

@RestController
@RequestMapping("/api/v1/online-classes/{classId}/kolin")
@PreAuthorize("hasRole('TEACHER')")
public class KolinChatController {
    private final KolinChatService chat;
    @org.springframework.beans.factory.annotation.Autowired
    private KolinWorksheetStore worksheets;
    public KolinChatController(KolinChatService chat) { this.chat = chat; }

    @ExceptionHandler(KolinRequestException.class)
    public ResponseEntity<com.mcschool.flashcard.common.ApiErrorResponse> failure(
            KolinRequestException error,jakarta.servlet.http.HttpServletRequest request) {
        return ResponseEntity.status(error.getStatusCode()).body(com.mcschool.flashcard.common.ApiErrorResponse.of(
                error.getStatusCode().value(),error.getErrorCode(),error.getReason(),request.getRequestURI()));
    }

    @GetMapping("/status")
    public Map<String, Boolean> status(@AuthenticationPrincipal AuthenticatedUser caller, @PathVariable UUID classId) {
        return chat.status(caller, classId);
    }

    @GetMapping("/questions")
    public ResponseEntity<java.util.List<KolinQuestionJournal.View>> questions(
            @AuthenticationPrincipal AuthenticatedUser caller, @PathVariable UUID classId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(chat.questions(caller, classId));
    }

    @PostMapping("/review-target")
    public ResponseEntity<KolinBoardReviewService.Target> reviewTarget(@AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,@Valid @RequestBody KolinBoardReviewService.TargetRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(chat.reviewTarget(caller,classId,request));
    }

    @PostMapping("/messages")
    public KolinChatService.Reply send(@AuthenticationPrincipal AuthenticatedUser caller, @PathVariable UUID classId,
                                      @Valid @RequestBody KolinChatService.Request request) {
        return chat.send(caller, classId, request);
    }

    @GetMapping("/worksheets/{id}/preview")
    public ResponseEntity<byte[]> preview(@AuthenticationPrincipal AuthenticatedUser caller,@PathVariable UUID classId,@PathVariable UUID id) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options","nosniff").body(worksheets.file(caller,classId,id,true));
    }
    @GetMapping("/worksheets/{id}/pdf")
    public ResponseEntity<byte[]> pdf(@AuthenticationPrincipal AuthenticatedUser caller,@PathVariable UUID classId,@PathVariable UUID id) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION,"inline; filename=kolin-worksheet.pdf")
                .header("X-Content-Type-Options","nosniff").body(worksheets.file(caller,classId,id,false));
    }
    @PostMapping("/worksheets/{id}/append")
    public KolinWorksheetStore.Worksheet append(@AuthenticationPrincipal AuthenticatedUser caller,@PathVariable UUID classId,@PathVariable UUID id) {
        return worksheets.append(caller,classId,id);
    }
}
