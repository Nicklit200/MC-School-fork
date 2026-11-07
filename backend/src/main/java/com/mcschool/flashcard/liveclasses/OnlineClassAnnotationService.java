package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbookService;
import com.mcschool.flashcard.liveclasses.dto.AnnotationDocumentResponse;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.users.User;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Shared whiteboard and screen-share annotation.
 *
 * <p>Operations are stored in a per-document ordered stream so a late joiner or
 * a reconnecting client can replay from a known revision. De-duplication is by
 * client {@code operationId}, so the realtime copy and the persisted row
 * collapse onto one.
 */
@Service
public class OnlineClassAnnotationService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassAnnotationService.class);

    /** Bounded so a replay request cannot pull an unbounded stream. */
    static final int MAX_REPLAY_OPERATIONS = 5000;
    private static final int MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

    private final OnlineClassAnnotationDocumentRepository documentRepository;
    private final OnlineClassAnnotationEventRepository eventRepository;
    private final OnlineClassAccessService accessService;
    private final AnnotationPayloadValidator validator;
    private final ClassArtifactStorage storage;
    private final java.time.Clock clock;
    private final PersonalLessonWorkbookService personalWorkbooks;

    public OnlineClassAnnotationService(OnlineClassAnnotationDocumentRepository documentRepository,
                                        OnlineClassAnnotationEventRepository eventRepository,
                                        OnlineClassAccessService accessService,
                                        AnnotationPayloadValidator validator,
                                        ClassArtifactStorage storage,
                                        java.time.Clock clock,
                                        PersonalLessonWorkbookService personalWorkbooks) {
        this.documentRepository = documentRepository;
        this.eventRepository = eventRepository;
        this.accessService = accessService;
        this.validator = validator;
        this.storage = storage;
        this.clock = clock;
        this.personalWorkbooks = personalWorkbooks;
    }

    /** Creates or returns the document for one surface and page. */
    @Transactional
    public AnnotationDocumentResponse openDocument(AuthenticatedUser caller, UUID classId,
                                                   AnnotationTargetType targetType, String targetId,
                                                   int pageIndex, Integer sourceWidth,
                                                   Integer sourceHeight) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        accessService.lockForAnnotationWrite(onlineClass);
        requireBoardAccess(caller, onlineClass, targetId);
        String canonicalTarget = canonicalWriteTarget(onlineClass, targetType, targetId);
        requireBoardAccess(caller, onlineClass, canonicalTarget);
        if (pageIndex < 0) {
            throw new IllegalArgumentException("Page index must not be negative");
        }
        OnlineClassAnnotationDocument document = documentRepository
                .findByOnlineClassIdAndTargetTypeAndTargetIdAndPageIndex(
                        classId, targetType, canonicalTarget, pageIndex)
                .orElseGet(() -> {
                    // Safe under concurrency: a simultaneous opener's row wins
                    // and is read back here, rather than failing this request.
                    documentRepository.insertIfAbsent(
                            UUID.randomUUID(), classId, targetType.name(), canonicalTarget, pageIndex);
                    return documentRepository
                            .findByOnlineClassIdAndTargetTypeAndTargetIdAndPageIndex(
                                    classId, targetType, canonicalTarget, pageIndex)
                            .orElseThrow(() -> new IllegalStateException(
                                    "Annotation document missing after insert"));
                });

        if (sourceWidth != null && sourceHeight != null && document.getSourceWidth() == null) {
            // Recorded once, from whoever opened the surface first: it describes
            // the shared source, not one viewer's window.
            document.describeSource(sourceWidth, sourceHeight);
        }
        return AnnotationDocumentResponse.from(document);
    }

    /**
     * Appends an operation.
     *
     * <p>Idempotent on {@code operationId}: a retry, or the same operation
     * arriving over both the data channel and HTTP, yields one row.
     */
    @Transactional
    public AnnotationOperationResponse append(AuthenticatedUser caller, UUID classId,
                                              UUID documentId, AnnotationOperationRequest request) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        accessService.lockForAnnotationWrite(onlineClass);
        OnlineClassAnnotationDocument document = documentRepository.findForUpdate(documentId, classId)
                .orElseThrow(() -> new ResourceNotFoundException("Annotation document not found"));
        requireBoardAccess(caller, onlineClass, document.getTargetId());
        User actor = accessService.requireActiveUser(caller.id());
        boolean host = accessService.isHost(caller, onlineClass);

        var existing = eventRepository.findByDocumentIdAndOperationId(documentId, request.operationId());
        if (existing.isPresent()) {
            return AnnotationOperationResponse.from(existing.get());
        }

        if (onlineClass.isTerminal()) {
            throw new ConflictException("This class has ended");
        }

        // Only the host may clear everything; a student clears their own layer.
        if (request.operationType() == AnnotationOperationType.CLEAR_ALL && !host) {
            throw new ResourceNotFoundException("Annotation document not found");
        }

        // The layer owner is the actor, always. A client cannot draw into — or
        // clear — someone else's layer by naming them in the request.
        User layerOwner = actor;

        String payload = validator.validate(request.operationType(), request.payload());
        validateInteraction(document,request,host,payload);
        long sequence = document.nextRevision();

        OnlineClassAnnotationEvent event = eventRepository.save(
                OnlineClassAnnotationEvent.record(document, request.operationId(), sequence,
                        actor, layerOwner, request.operationType(), payload));
        return AnnotationOperationResponse.from(event);
    }

    /** Called under the document row lock, so stale editors never silently overwrite a peer's change. */
    private void validateInteraction(OnlineClassAnnotationDocument document,AnnotationOperationRequest request,boolean host,String payload) {
        var next=InteractiveTemplateSpec.payload(payload);
        if(!"interactive".equals(next.get("kind"))) {
            // Ordinary UPDATEs cannot replace a template and bypass its revision check.
            if(request.operationType()==AnnotationOperationType.UPDATE && next.get("targetOperationId") instanceof String id) {
                try { eventRepository.findByDocumentIdAndOperationId(document.getId(),UUID.fromString(id)).ifPresent(original -> {
                    if("interactive".equals(InteractiveTemplateSpec.payload(original.getPayload()).get("kind")))
                        throw new ConflictException("Interactive template requires an interactive update");
                }); } catch(IllegalArgumentException ex) { throw new ConflictException("Invalid update target"); }
            }
            return;
        }
        if(document.getTargetType()!=AnnotationTargetType.WHITEBOARD || !PersonalBoard.isWorkbook(document.getTargetId()))
            throw new ConflictException("Interactive templates require a personal workbook");
        if(request.operationType()==AnnotationOperationType.ADD) {
            if(!host) throw new ResourceNotFoundException("Annotation document not found");
            return;
        }
        UUID target=UUID.fromString((String)next.get("targetOperationId"));
        var original=eventRepository.findByDocumentIdAndOperationId(document.getId(),target).orElseThrow(() -> new ConflictException("Template not found"));
        var initial=InteractiveTemplateSpec.payload(original.getPayload());
        if(original.getOperationType()!=AnnotationOperationType.ADD || !"interactive".equals(initial.get("kind")))
            throw new ConflictException("Template not found");
        InteractiveTemplateSpec.sameTemplate(InteractiveTemplateSpec.read(initial.get("interactive")),InteractiveTemplateSpec.read(next.get("interactive")));
        var events=eventRepository.findAllByDocumentIdOrderBySequenceAsc(document.getId());
        if(events.size()>=MAX_REPLAY_OPERATIONS) throw new ConflictException("Please create a new interactive page");
        UUID revision=target; boolean visible=false,undone=false;
        for(var event:events) {
            if(event.getOperationId().equals(target)) visible=true;
            var data=InteractiveTemplateSpec.payload(event.getPayload());
            boolean own=event.getLayerOwner().getId().equals(original.getLayerOwner().getId());
            if(event.getOperationType()==AnnotationOperationType.CLEAR_ALL) { visible=false;undone=false; }
            if(event.getOperationType()==AnnotationOperationType.CLEAR_LAYER && own) visible=false;
            if(target.toString().equals(data.get("targetOperationId"))) {
                if(event.getOperationType()==AnnotationOperationType.UNDO && own && visible) { visible=false;undone=true; }
                if(event.getOperationType()==AnnotationOperationType.REDO && own && undone) { visible=true;undone=false; }
                if(event.getOperationType()==AnnotationOperationType.UPDATE && visible) revision=event.getOperationId();
            }
        }
        if(!visible || !revision.toString().equals(next.get("baseOperationId")))
            throw new ConflictException("Interactive template changed; reopen it to use the current state");
    }

    /**
     * Replays operations after a known revision, for a late joiner or reconnect.
     * Passing 0 returns the whole document.
     */
    @Transactional(readOnly = true)
    public List<AnnotationOperationResponse> replay(AuthenticatedUser caller, UUID classId,
                                                    UUID documentId, long afterSequence) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        OnlineClassAnnotationDocument document = requireDocument(classId, documentId);
        requireBoardAccess(caller, onlineClass, document.getTargetId());

        return eventRepository
                .findAllByDocumentIdAndSequenceGreaterThanOrderBySequenceAsc(documentId, afterSequence)
                .stream()
                .limit(MAX_REPLAY_OPERATIONS)
                .map(AnnotationOperationResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AnnotationDocumentResponse> listDocuments(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireAdmitted(caller, classId);
        // All pages of one target share its owner and roster checks. Keep this
        // cache local to this read so polling does not repeat those database
        // checks per page, while the next request rechecks revoked membership.
        Map<String, Boolean> targetAccess = new HashMap<>();
        return documentRepository.findAllByOnlineClassIdOrderByPageIndexAsc(classId).stream()
                // Someone else's private board is not merely unreadable: it is not listed.
                .filter(document -> targetAccess.computeIfAbsent(document.getTargetId(),
                        targetId -> canAccessBoard(caller, onlineClass, targetId)))
                .map(AnnotationDocumentResponse::from)
                .toList();
    }

    /**
     * Saves a flattened snapshot as a lesson artifact. Teacher-only: it becomes
     * a durable record of the class.
     *
     * @param pngBase64 the rendered board, produced client-side
     */
    @Transactional
    public AnnotationDocumentResponse saveSnapshot(AuthenticatedUser caller, UUID classId,
                                                   UUID documentId, String pngBase64) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        accessService.lockForAnnotationWrite(onlineClass);
        OnlineClassAnnotationDocument document = requireDocument(classId, documentId);
        requireBoardAccess(caller, onlineClass, document.getTargetId());

        if (!storage.isConfigured()) {
            throw new ConflictException("Artifact storage is not configured");
        }

        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(
                    pngBase64.replaceFirst("^data:image/png;base64,", "")
                            .getBytes(StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            throw new ConflictException("Snapshot is not valid base64");
        }
        if (bytes.length == 0 || bytes.length > MAX_SNAPSHOT_BYTES) {
            throw new ConflictException("Snapshot size is out of range");
        }

        String snapshotFilename = PersonalBoard.isWorkbook(document.getTargetId())
                ? "whiteboard-" + document.getId() + "-" + document.getPageIndex() + ".png"
                : "whiteboard-" + document.getPageIndex() + ".png";
        String objectKey = storage.buildObjectKey(classId.toString(), snapshotFilename);
        storage.put(objectKey, bytes, "image/png");
        document.recordSnapshot(objectKey, clock.instant());
        log.info("Whiteboard snapshot saved: classId={} page={}", classId, document.getPageIndex());
        return AnnotationDocumentResponse.from(document);
    }

    /**
     * Shared surfaces are open to every participant. A personal board is open
     * only to its owner and the class's teacher; anyone else gets the same
     * not-found as for a missing document.
     */
    private boolean canAccessBoard(AuthenticatedUser caller, OnlineClass onlineClass, String targetId) {
        if (PersonalBoard.isWorkbook(targetId)) {
            var owner = PersonalBoard.ownerOf(targetId);
            if (owner.isEmpty() || !personalWorkbooks.enabledForTeacher(onlineClass.getTeacher().getId())) {
                return false;
            }
            if (!owner.get().equals(caller.id()) && !accessService.isHost(caller, onlineClass)) {
                return false;
            }
            try {
                // Hosts also lose access when the pupil is removed or reassigned.
                personalWorkbooks.requireClassStudent(onlineClass, owner.get());
                return true;
            } catch (ResourceNotFoundException removed) {
                return false;
            }
        }
        if (!PersonalBoard.isPersonal(targetId)) {
            return true;
        }
        if (accessService.isHost(caller, onlineClass)) {
            return true;
        }
        return PersonalBoard.ownerOf(targetId).filter(owner -> owner.equals(caller.id())).isPresent();
    }

    private void requireBoardAccess(AuthenticatedUser caller, OnlineClass onlineClass, String targetId) {
        if (!canAccessBoard(caller, onlineClass, targetId)) {
            throw new ResourceNotFoundException("Annotation document not found");
        }
    }

    private String canonicalWriteTarget(OnlineClass room, AnnotationTargetType type, String targetId) {
        if (type == AnnotationTargetType.WHITEBOARD && PersonalBoard.isPersonal(targetId)
                && !PersonalBoard.isWorkbook(targetId) && personalWorkbooks.enabledForTeacher(room.getTeacher().getId())) {
            var owner = PersonalBoard.ownerOf(targetId);
            if (owner.isPresent() && personalWorkbooks.workbookVersionForClass(room, owner.get()) > 0)
                return PersonalBoard.workbookTargetIdFor(owner.get());
        }
        return targetId;
    }

    private OnlineClassAnnotationDocument requireDocument(UUID classId, UUID documentId) {
        return documentRepository.findByIdAndOnlineClassId(documentId, classId)
                .orElseThrow(() -> new ResourceNotFoundException("Annotation document not found"));
    }
}
