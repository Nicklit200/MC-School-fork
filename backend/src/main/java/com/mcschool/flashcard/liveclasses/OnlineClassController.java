package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.dto.AnnotationDocumentResponse;
import com.mcschool.flashcard.liveclasses.dto.AttendanceStudentResponse;
import com.mcschool.flashcard.liveclasses.dto.FinishClassRequest;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassBoardContextResponse;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationResponse;
import com.mcschool.flashcard.liveclasses.dto.ChatMessageResponse;
import com.mcschool.flashcard.liveclasses.dto.ChatPageResponse;
import com.mcschool.flashcard.liveclasses.dto.ClassParticipantResponse;
import com.mcschool.flashcard.liveclasses.dto.ConnectionRequest;
import com.mcschool.flashcard.liveclasses.dto.JoinRequestResponse;
import com.mcschool.flashcard.liveclasses.dto.ParticipantPermissionRequest;
import com.mcschool.flashcard.liveclasses.dto.RecordingResponse;
import com.mcschool.flashcard.liveclasses.dto.SendMessageRequest;
import com.mcschool.flashcard.liveclasses.dto.SnapshotRequest;
import com.mcschool.flashcard.liveclasses.dto.TranscriptSegmentResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassConnectionResponse;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Online-class lifecycle and connection API.
 *
 * <p>Method-level {@code @PreAuthorize} only narrows by role; the actual
 * ownership and binding checks happen in {@link OnlineClassAccessService}, since
 * a role alone never proves a caller belongs to a particular class.
 */
@RestController
@RequestMapping("/api/v1/online-classes")
@PreAuthorize("hasAnyRole('TEACHER', 'STUDENT')")
public class OnlineClassController {

    private final OnlineClassService onlineClassService;
    private final OnlineClassAdmissionService admissionService;
    private final OnlineClassHostControlService hostControlService;
    private final OnlineClassAttendanceService attendanceService;
    private final OnlineClassChatService chatService;
    private final OnlineClassRecordingService recordingService;
    private final OnlineClassTranscriptService transcriptService;
    private final OnlineClassAnnotationService annotationService;
    private final OnlineClassBoardService boardService;

    public OnlineClassController(OnlineClassService onlineClassService,
                                 OnlineClassAdmissionService admissionService,
                                 OnlineClassHostControlService hostControlService,
                                 OnlineClassAttendanceService attendanceService,
                                 OnlineClassChatService chatService,
                                 OnlineClassRecordingService recordingService,
                                 OnlineClassTranscriptService transcriptService,
                                 OnlineClassAnnotationService annotationService,
                                 OnlineClassBoardService boardService) {
        this.onlineClassService = onlineClassService;
        this.admissionService = admissionService;
        this.hostControlService = hostControlService;
        this.attendanceService = attendanceService;
        this.chatService = chatService;
        this.recordingService = recordingService;
        this.transcriptService = transcriptService;
        this.annotationService = annotationService;
        this.boardService = boardService;
    }

    /** Creates or returns the durable class for a calendar occurrence. */
    @PostMapping("/calendar/{eventId}")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse materializeFromCalendar(@AuthenticationPrincipal AuthenticatedUser caller,
                                                       @PathVariable String eventId) {
        return onlineClassService.materializeFromCalendar(caller, eventId);
    }

    /**
     * Classes already materialized for a calendar event. Read-only: opening a
     * lesson page must not create a class as a side effect.
     */
    @GetMapping("/by-event/{eventId}")
    @PreAuthorize("hasRole('TEACHER')")
    public List<OnlineClassResponse> findByEvent(@AuthenticationPrincipal AuthenticatedUser caller,
                                                 @PathVariable String eventId) {
        return onlineClassService.findByEvent(caller, eventId);
    }

    /**
     * Creates a class without Google Calendar, for testing environments.
     *
     * <p>Returns 404 unless {@code app.online-classes.allow-test-classes} is
     * explicitly enabled. Never enable it in production.
     */
    @PostMapping("/test-class")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse createTestClass(@AuthenticationPrincipal AuthenticatedUser caller,
                                               @RequestParam(required = false) UUID studentId,
                                               @RequestParam(required = false) UUID groupId,
                                               @RequestParam(required = false) String title) {
        return onlineClassService.createTestClass(caller, studentId, groupId, title);
    }

    /** Role-filtered upcoming and live classes for the caller. */
    @GetMapping("/upcoming")
    public List<OnlineClassResponse> listUpcoming(@AuthenticationPrincipal AuthenticatedUser caller) {
        return onlineClassService.listUpcoming(caller);
    }

    /** Completed lessons remain available as a student's durable lesson history. */
    @GetMapping("/history")
    public List<OnlineClassResponse> history(@AuthenticationPrincipal AuthenticatedUser caller) {
        return onlineClassService.listHistory(caller);
    }

    /** Completed online lessons for a student owned by the current teacher. */
    @GetMapping("/students/{studentId}/history")
    @PreAuthorize("hasRole('TEACHER')")
    public List<OnlineClassResponse> studentHistory(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID studentId) {
        return onlineClassService.listStudentHistory(caller, studentId);
    }

    @GetMapping("/{classId}")
    public OnlineClassResponse get(@AuthenticationPrincipal AuthenticatedUser caller,
                                   @PathVariable UUID classId) {
        return onlineClassService.get(caller, classId);
    }

    @PostMapping("/{classId}/open-lobby")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse openLobby(@AuthenticationPrincipal AuthenticatedUser caller,
                                         @PathVariable UUID classId) {
        return onlineClassService.openLobby(caller, classId);
    }

    @PostMapping("/{classId}/start")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse start(@AuthenticationPrincipal AuthenticatedUser caller,
                                     @PathVariable UUID classId) {
        return onlineClassService.start(caller, classId);
    }

    @PostMapping("/{classId}/end")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse end(@AuthenticationPrincipal AuthenticatedUser caller,
                                   @PathVariable UUID classId) {
        return onlineClassService.end(caller, classId);
    }

    @PostMapping("/{classId}/cancel")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse cancel(@AuthenticationPrincipal AuthenticatedUser caller,
                                      @PathVariable UUID classId) {
        return onlineClassService.cancel(caller, classId);
    }

    /** Returns the server URL and a short-lived scoped token. */
    @PostMapping("/{classId}/connection")
    public OnlineClassConnectionResponse connect(@AuthenticationPrincipal AuthenticatedUser caller,
                                                 @PathVariable UUID classId,
                                                 @Valid @RequestBody(required = false)
                                                 ConnectionRequest request) {
        String deviceId = request == null ? null : request.deviceId();
        return onlineClassService.connect(caller, classId, deviceId);
    }

    @PostMapping("/{classId}/leave")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(@AuthenticationPrincipal AuthenticatedUser caller,
                      @PathVariable UUID classId) {
        onlineClassService.leave(caller, classId);
    }

    // --- Waiting room --------------------------------------------------------

    /** Requests entry. Idempotent: a refresh returns the same pending request. */
    @PostMapping("/{classId}/join-requests")
    public JoinRequestResponse knock(@AuthenticationPrincipal AuthenticatedUser caller,
                                     @PathVariable UUID classId) {
        return admissionService.knock(caller, classId);
    }

    @GetMapping("/{classId}/join-requests")
    @PreAuthorize("hasRole('TEACHER')")
    public List<JoinRequestResponse> listJoinRequests(@AuthenticationPrincipal AuthenticatedUser caller,
                                                      @PathVariable UUID classId) {
        return admissionService.listPending(caller, classId);
    }

    @PostMapping("/{classId}/join-requests/{requestId}/approve")
    @PreAuthorize("hasRole('TEACHER')")
    public JoinRequestResponse approve(@AuthenticationPrincipal AuthenticatedUser caller,
                                       @PathVariable UUID classId, @PathVariable UUID requestId) {
        return admissionService.approve(caller, classId, requestId);
    }

    @PostMapping("/{classId}/join-requests/{requestId}/reject")
    @PreAuthorize("hasRole('TEACHER')")
    public JoinRequestResponse reject(@AuthenticationPrincipal AuthenticatedUser caller,
                                      @PathVariable UUID classId, @PathVariable UUID requestId) {
        return admissionService.reject(caller, classId, requestId);
    }

    @PostMapping("/{classId}/join-requests/approve-all")
    @PreAuthorize("hasRole('TEACHER')")
    public List<JoinRequestResponse> approveAll(@AuthenticationPrincipal AuthenticatedUser caller,
                                                @PathVariable UUID classId) {
        return admissionService.approveAll(caller, classId);
    }

    // --- Participants and host controls --------------------------------------

    @GetMapping("/{classId}/participants")
    public List<ClassParticipantResponse> participants(@AuthenticationPrincipal AuthenticatedUser caller,
                                                       @PathVariable UUID classId) {
        return hostControlService.listParticipants(caller, classId);
    }

    /** Attendance is teacher-only: it exposes per-student timings. */
    @GetMapping("/{classId}/attendance")
    @PreAuthorize("hasRole('TEACHER')")
    public List<ClassParticipantResponse> attendance(@AuthenticationPrincipal AuthenticatedUser caller,
                                                     @PathVariable UUID classId) {
        return hostControlService.attendance(caller, classId);
    }

    /** Full scheduled roster, including students who never connected. */
    @GetMapping("/{classId}/attendance-roster")
    @PreAuthorize("hasRole('TEACHER')")
    public List<AttendanceStudentResponse> attendanceRoster(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId) {
        return attendanceService.roster(caller, classId);
    }

    /** Teacher confirms present/absent, then the room is ended for everyone. */
    @PostMapping("/{classId}/finish")
    @PreAuthorize("hasRole('TEACHER')")
    public OnlineClassResponse finish(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,
            @RequestBody FinishClassRequest request) {
        attendanceService.confirm(caller, classId, request == null ? null : request.attendance());
        return onlineClassService.end(caller, classId);
    }

    @PostMapping("/{classId}/participants/{userId}/mute")
    @PreAuthorize("hasRole('TEACHER')")
    public ClassParticipantResponse mute(@AuthenticationPrincipal AuthenticatedUser caller,
                                         @PathVariable UUID classId, @PathVariable UUID userId) {
        return hostControlService.muteParticipant(caller, classId, userId);
    }

    /**
     * Asks a participant to unmute. Browsers require local consent, so this is a
     * request rather than a command.
     */
    @PostMapping("/{classId}/participants/{userId}/unmute-request")
    @PreAuthorize("hasRole('TEACHER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void requestUnmute(@AuthenticationPrincipal AuthenticatedUser caller,
                              @PathVariable UUID classId, @PathVariable UUID userId) {
        hostControlService.requestUnmute(caller, classId, userId);
    }

    @PostMapping("/{classId}/participants/{userId}/remove")
    @PreAuthorize("hasRole('TEACHER')")
    public ClassParticipantResponse removeParticipant(@AuthenticationPrincipal AuthenticatedUser caller,
                                                      @PathVariable UUID classId,
                                                      @PathVariable UUID userId) {
        return hostControlService.removeParticipant(caller, classId, userId);
    }

    @PostMapping("/{classId}/participants/{userId}/permissions")
    @PreAuthorize("hasRole('TEACHER')")
    public ClassParticipantResponse updatePermissions(@AuthenticationPrincipal AuthenticatedUser caller,
                                                      @PathVariable UUID classId,
                                                      @PathVariable UUID userId,
                                                      @Valid @RequestBody ParticipantPermissionRequest request) {
        return hostControlService.updatePermissions(caller, classId, userId, request);
    }

    @PostMapping("/{classId}/mute-all-students")
    @PreAuthorize("hasRole('TEACHER')")
    public List<ClassParticipantResponse> muteAll(@AuthenticationPrincipal AuthenticatedUser caller,
                                                  @PathVariable UUID classId) {
        return hostControlService.muteAllStudents(caller, classId);
    }

    @PostMapping("/{classId}/settings/student-screen-share")
    @PreAuthorize("hasRole('TEACHER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setStudentScreenShare(@AuthenticationPrincipal AuthenticatedUser caller,
                                      @PathVariable UUID classId,
                                      @RequestParam boolean enabled) {
        hostControlService.setStudentScreenShare(caller, classId, enabled);
    }

    @PostMapping("/{classId}/settings/waiting-room")
    @PreAuthorize("hasRole('TEACHER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setWaitingRoom(@AuthenticationPrincipal AuthenticatedUser caller,
                               @PathVariable UUID classId,
                               @RequestParam boolean enabled) {
        hostControlService.setWaitingRoom(caller, classId, enabled);
    }

    // --- Chat ----------------------------------------------------------------

    /** Idempotent on {@code clientMessageId}: a retry returns the original. */
    @PostMapping("/{classId}/messages")
    public ChatMessageResponse sendMessage(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID classId,
                                           @Valid @RequestBody SendMessageRequest request) {
        return chatService.send(caller, classId, request.clientMessageId(), request.body());
    }

    /** Cursor-paginated history; pass the previous page's cursor as {@code before}. */
    @GetMapping("/{classId}/messages")
    public ChatPageResponse messageHistory(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID classId,
                                           @RequestParam(required = false) UUID before,
                                           @RequestParam(required = false) Integer size) {
        return chatService.history(caller, classId, before, size);
    }

    @PutMapping("/{classId}/messages/{messageId}")
    public ChatMessageResponse editMessage(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID classId,
                                           @PathVariable UUID messageId,
                                           @Valid @RequestBody SendMessageRequest request) {
        return chatService.edit(caller, classId, messageId, request.body());
    }

    @DeleteMapping("/{classId}/messages/{messageId}")
    public ChatMessageResponse deleteMessage(@AuthenticationPrincipal AuthenticatedUser caller,
                                             @PathVariable UUID classId,
                                             @PathVariable UUID messageId) {
        return chatService.delete(caller, classId, messageId);
    }

    // --- Recording -----------------------------------------------------------

    @PostMapping("/{classId}/recordings/start")
    @PreAuthorize("hasRole('TEACHER')")
    public RecordingResponse startRecording(@AuthenticationPrincipal AuthenticatedUser caller,
                                            @PathVariable UUID classId) {
        return recordingService.start(caller, classId);
    }

    @PostMapping("/{classId}/recordings/stop")
    @PreAuthorize("hasRole('TEACHER')")
    public RecordingResponse stopRecording(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID classId) {
        return recordingService.stop(caller, classId);
    }

    /** Teacher-only; download URLs are short-lived signed links. */
    @GetMapping("/{classId}/recordings")
    @PreAuthorize("hasRole('TEACHER')")
    public List<RecordingResponse> listRecordings(@AuthenticationPrincipal AuthenticatedUser caller,
                                                  @PathVariable UUID classId) {
        return recordingService.list(caller, classId);
    }

    /** Records that this participant saw the recording notice. */
    @PostMapping("/{classId}/recordings/acknowledge")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void acknowledgeRecording(@AuthenticationPrincipal AuthenticatedUser caller,
                                     @PathVariable UUID classId) {
        recordingService.acknowledgeRecording(caller, classId);
    }

    // --- Transcription -------------------------------------------------------

    @PostMapping("/{classId}/transcription/start")
    @PreAuthorize("hasRole('TEACHER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void startTranscription(@AuthenticationPrincipal AuthenticatedUser caller,
                                   @PathVariable UUID classId,
                                   @RequestParam(required = false) List<String> languages) {
        transcriptService.start(caller, classId, languages);
    }

    @PostMapping("/{classId}/transcription/stop")
    @PreAuthorize("hasRole('TEACHER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void stopTranscription(@AuthenticationPrincipal AuthenticatedUser caller,
                                  @PathVariable UUID classId) {
        transcriptService.stop(caller, classId);
    }

    /** Structured transcript. Teacher-only, like recordings. */
    @GetMapping("/{classId}/transcript")
    @PreAuthorize("hasRole('TEACHER')")
    public List<TranscriptSegmentResponse> transcript(@AuthenticationPrincipal AuthenticatedUser caller,
                                                      @PathVariable UUID classId) {
        return transcriptService.segments(caller, classId);
    }

    @GetMapping(value = "/{classId}/transcript.txt", produces = "text/plain; charset=UTF-8")
    @PreAuthorize("hasRole('TEACHER')")
    public String transcriptText(@AuthenticationPrincipal AuthenticatedUser caller,
                                 @PathVariable UUID classId) {
        return transcriptService.exportText(caller, classId);
    }

    @GetMapping(value = "/{classId}/transcript.vtt", produces = "text/vtt; charset=UTF-8")
    @PreAuthorize("hasRole('TEACHER')")
    public String transcriptVtt(@AuthenticationPrincipal AuthenticatedUser caller,
                                @PathVariable UUID classId) {
        return transcriptService.exportVtt(caller, classId);
    }

    // --- Classroom boards and workbook ----------------------------------------

    @GetMapping("/{classId}/board-context")
    public OnlineClassBoardContextResponse boardContext(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId) {
        return boardService.context(caller, classId);
    }

    @GetMapping(value = "/{classId}/workbook/pages/{pageIndex}.png", produces = MediaType.IMAGE_PNG_VALUE)
    public byte[] workbookPage(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,
            @PathVariable int pageIndex) {
        return boardService.renderWorkbookPage(caller, classId, pageIndex);
    }

    // --- Annotations ---------------------------------------------------------

    /** Creates or returns the document for one surface and page. */
    @PostMapping("/{classId}/annotations/documents")
    public AnnotationDocumentResponse openAnnotationDocument(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,
            @RequestParam AnnotationTargetType targetType,
            @RequestParam String targetId,
            @RequestParam(defaultValue = "0") int pageIndex,
            @RequestParam(required = false) Integer sourceWidth,
            @RequestParam(required = false) Integer sourceHeight) {
        return annotationService.openDocument(caller, classId, targetType, targetId, pageIndex,
                sourceWidth, sourceHeight);
    }

    @GetMapping("/{classId}/annotations/documents")
    public List<AnnotationDocumentResponse> listAnnotationDocuments(
            @AuthenticationPrincipal AuthenticatedUser caller, @PathVariable UUID classId) {
        return annotationService.listDocuments(caller, classId);
    }

    /** Idempotent on operationId, so the realtime copy and this collapse to one. */
    @PostMapping("/{classId}/annotations/documents/{documentId}/operations")
    public AnnotationOperationResponse appendAnnotation(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,
            @PathVariable UUID documentId,
            @Valid @RequestBody AnnotationOperationRequest request) {
        return annotationService.append(caller, classId, documentId, request);
    }

    /** Replay for a late joiner or reconnect; pass the last sequence seen. */
    @GetMapping("/{classId}/annotations/documents/{documentId}/operations")
    public List<AnnotationOperationResponse> replayAnnotations(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,
            @PathVariable UUID documentId,
            @RequestParam(defaultValue = "0") long afterSequence) {
        return annotationService.replay(caller, classId, documentId, afterSequence);
    }

    /** Teacher-only: saves the board as a durable lesson artifact. */
    @PostMapping("/{classId}/annotations/documents/{documentId}/snapshot")
    @PreAuthorize("hasRole('TEACHER')")
    public AnnotationDocumentResponse saveAnnotationSnapshot(
            @AuthenticationPrincipal AuthenticatedUser caller,
            @PathVariable UUID classId,
            @PathVariable UUID documentId,
            @Valid @RequestBody SnapshotRequest request) {
        return annotationService.saveSnapshot(caller, classId, documentId, request.pngBase64());
    }
}
