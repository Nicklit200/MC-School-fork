package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.AnnotationDocumentResponse;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.users.User;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
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

    public OnlineClassAnnotationService(OnlineClassAnnotationDocumentRepository documentRepository,
                                        OnlineClassAnnotationEventRepository eventRepository,
                                        OnlineClassAccessService accessService,
                                        AnnotationPayloadValidator validator,
                                        ClassArtifactStorage storage,
                                        java.time.Clock clock) {
        this.documentRepository = documentRepository;
        this.eventRepository = eventRepository;
        this.accessService = accessService;
        this.validator = validator;
        this.storage = storage;
        this.clock = clock;
    }

    /** Creates or returns the document for one surface and page. */
    @Transactional
    public AnnotationDocumentResponse openDocument(AuthenticatedUser caller, UUID classId,
                                                   AnnotationTargetType targetType, String targetId,
                                                   int pageIndex, Integer sourceWidth,
                                                   Integer sourceHeight) {
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        OnlineClassAnnotationDocument document = documentRepository
                .findByOnlineClassIdAndTargetTypeAndTargetIdAndPageIndex(
                        classId, targetType, targetId, pageIndex)
                .orElseGet(() -> documentRepository.save(OnlineClassAnnotationDocument.create(
                        onlineClass, targetType, targetId, pageIndex)));

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
        OnlineClass onlineClass = accessService.requireParticipant(caller, classId);
        OnlineClassAnnotationDocument document = requireDocument(classId, documentId);
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
        long sequence = document.nextRevision();

        OnlineClassAnnotationEvent event = eventRepository.save(
                OnlineClassAnnotationEvent.record(document, request.operationId(), sequence,
                        actor, layerOwner, request.operationType(), payload));
        return AnnotationOperationResponse.from(event);
    }

    /**
     * Replays operations after a known revision, for a late joiner or reconnect.
     * Passing 0 returns the whole document.
     */
    @Transactional(readOnly = true)
    public List<AnnotationOperationResponse> replay(AuthenticatedUser caller, UUID classId,
                                                    UUID documentId, long afterSequence) {
        accessService.requireParticipant(caller, classId);
        requireDocument(classId, documentId);

        return eventRepository
                .findAllByDocumentIdAndSequenceGreaterThanOrderBySequenceAsc(documentId, afterSequence)
                .stream()
                .limit(MAX_REPLAY_OPERATIONS)
                .map(AnnotationOperationResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AnnotationDocumentResponse> listDocuments(AuthenticatedUser caller, UUID classId) {
        accessService.requireParticipant(caller, classId);
        return documentRepository.findAllByOnlineClassIdOrderByPageIndexAsc(classId).stream()
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
        accessService.requireHost(caller, classId);
        OnlineClassAnnotationDocument document = requireDocument(classId, documentId);

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

        String objectKey = storage.buildObjectKey(classId.toString(),
                "whiteboard-" + document.getPageIndex() + ".png");
        storage.put(objectKey, bytes, "image/png");
        document.recordSnapshot(objectKey, clock.instant());
        log.info("Whiteboard snapshot saved: classId={} page={}", classId, document.getPageIndex());
        return AnnotationDocumentResponse.from(document);
    }

    private OnlineClassAnnotationDocument requireDocument(UUID classId, UUID documentId) {
        return documentRepository.findByIdAndOnlineClassId(documentId, classId)
                .orElseThrow(() -> new ResourceNotFoundException("Annotation document not found"));
    }
}
