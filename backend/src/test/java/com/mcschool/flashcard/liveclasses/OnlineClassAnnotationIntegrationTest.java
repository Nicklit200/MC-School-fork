package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.AnnotationDocumentResponse;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationResponse;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Annotation documents, ordered operations, layers and snapshots. */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class OnlineClassAnnotationIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);
    private static final String PEN = "{\"kind\":\"pen\",\"width\":0.004,\"points\":[[0.1,0.2]]}";

    @Autowired
    private OnlineClassAnnotationService annotationService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassAnnotationEventRepository eventRepository;

    @Autowired
    private UserRepository userRepository;

    @MockitoBean
    private ClassArtifactStorage storage;

    private User teacher;
    private User student;
    private User outsider;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;
    private OnlineClass onlineClass;
    private AnnotationDocumentResponse board;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local", "t1", END));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local",
                teacher, "s1", END));
        outsider = userRepository.save(User.invitedStudent("Outsider", "outsider@test.local",
                teacher, "s2", END));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        studentPrincipal = new AuthenticatedUser(student.getId(), student.getEmail(), student.getRole());

        OnlineClass created = OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", START, END, student);
        created.start(START);
        onlineClass = classRepository.save(created);

        board = annotationService.openDocument(teacherPrincipal, onlineClass.getId(),
                AnnotationTargetType.WHITEBOARD, "board-1", 0, 1920, 1080);

        when(storage.isConfigured()).thenReturn(true);
        when(storage.buildObjectKey(anyString(), anyString())).thenReturn("classes/x/whiteboard-0.png");
    }

    private AnnotationOperationResponse draw(AuthenticatedUser caller, String payload) {
        return annotationService.append(caller, onlineClass.getId(), board.id(),
                new AnnotationOperationRequest(UUID.randomUUID(), AnnotationOperationType.ADD, payload));
    }

    // --- Documents -----------------------------------------------------------

    @Test
    void openingTheSameSurfaceTwiceReturnsOneDocument() {
        AnnotationDocumentResponse again = annotationService.openDocument(studentPrincipal,
                onlineClass.getId(), AnnotationTargetType.WHITEBOARD, "board-1", 0, null, null);

        assertThat(again.id()).isEqualTo(board.id());
        assertThat(again.sourceWidth()).isEqualTo(1920);
    }

    @Test
    void separatePagesAreSeparateDocuments() {
        AnnotationDocumentResponse pageTwo = annotationService.openDocument(teacherPrincipal,
                onlineClass.getId(), AnnotationTargetType.WHITEBOARD, "board-1", 1, null, null);

        assertThat(pageTwo.id()).isNotEqualTo(board.id());
        assertThat(annotationService.listDocuments(teacherPrincipal, onlineClass.getId())).hasSize(2);
    }

    @Test
    void aScreenShareOverlayIsADistinctSurface() {
        AnnotationDocumentResponse overlay = annotationService.openDocument(teacherPrincipal,
                onlineClass.getId(), AnnotationTargetType.SCREEN_SHARE, "track-1", 0, 2560, 1440);

        assertThat(overlay.targetType()).isEqualTo(AnnotationTargetType.SCREEN_SHARE);
        assertThat(overlay.id()).isNotEqualTo(board.id());
    }

    // --- Ordering and idempotency -------------------------------------------

    @Test
    void operationsGetIncreasingSequenceNumbers() {
        AnnotationOperationResponse first = draw(teacherPrincipal, PEN);
        AnnotationOperationResponse second = draw(studentPrincipal, PEN);

        assertThat(first.sequence()).isEqualTo(1L);
        assertThat(second.sequence()).isEqualTo(2L);
    }

    @Test
    void theSameOperationIdYieldsOneRow() {
        UUID operationId = UUID.randomUUID();
        AnnotationOperationRequest request =
                new AnnotationOperationRequest(operationId, AnnotationOperationType.ADD, PEN);

        AnnotationOperationResponse first =
                annotationService.append(teacherPrincipal, onlineClass.getId(), board.id(), request);
        AnnotationOperationResponse retry =
                annotationService.append(teacherPrincipal, onlineClass.getId(), board.id(), request);

        // The realtime copy and the HTTP copy of one stroke must collapse.
        assertThat(retry.id()).isEqualTo(first.id());
        assertThat(eventRepository.count()).isEqualTo(1);
    }

    @Test
    void replayReturnsOnlyWhatIsNewToTheCaller() {
        draw(teacherPrincipal, PEN);
        AnnotationOperationResponse second = draw(teacherPrincipal, PEN);
        draw(teacherPrincipal, PEN);

        List<AnnotationOperationResponse> since = annotationService.replay(
                studentPrincipal, onlineClass.getId(), board.id(), second.sequence());

        assertThat(since).hasSize(1);
        assertThat(since.get(0).sequence()).isEqualTo(3L);
    }

    @Test
    void aLateJoinerReplaysTheWholeDocument() {
        draw(teacherPrincipal, PEN);
        draw(studentPrincipal, PEN);

        assertThat(annotationService.replay(studentPrincipal, onlineClass.getId(), board.id(), 0))
                .hasSize(2)
                .extracting(AnnotationOperationResponse::sequence)
                .containsExactly(1L, 2L);
    }

    // --- Layers and permissions ---------------------------------------------

    @Test
    void anOperationAlwaysLandsInTheActorsOwnLayer() {
        AnnotationOperationResponse theirs = draw(studentPrincipal, PEN);

        // A client cannot draw into someone else's layer: the request has no
        // layer-owner field at all.
        assertThat(theirs.layerOwnerId()).isEqualTo(student.getId());
        assertThat(theirs.actorId()).isEqualTo(student.getId());
    }

    @Test
    void aStudentMayClearTheirOwnLayerButNotEverything() {
        assertThat(annotationService.append(studentPrincipal, onlineClass.getId(), board.id(),
                new AnnotationOperationRequest(UUID.randomUUID(),
                        AnnotationOperationType.CLEAR_LAYER, "{}")).operationType())
                .isEqualTo(AnnotationOperationType.CLEAR_LAYER);

        assertThatThrownBy(() -> annotationService.append(studentPrincipal, onlineClass.getId(),
                board.id(), new AnnotationOperationRequest(UUID.randomUUID(),
                        AnnotationOperationType.CLEAR_ALL, "{}")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void theHostMayClearEverything() {
        assertThat(annotationService.append(teacherPrincipal, onlineClass.getId(), board.id(),
                new AnnotationOperationRequest(UUID.randomUUID(),
                        AnnotationOperationType.CLEAR_ALL, "{}")).operationType())
                .isEqualTo(AnnotationOperationType.CLEAR_ALL);
    }

    @Test
    void anOutsiderCanNeitherDrawNorReplay() {
        AuthenticatedUser intruder =
                new AuthenticatedUser(outsider.getId(), outsider.getEmail(), outsider.getRole());

        assertThatThrownBy(() -> draw(intruder, PEN))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() ->
                annotationService.replay(intruder, onlineClass.getId(), board.id(), 0))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aDocumentFromAnotherClassIsNotReachable() {
        OnlineClass other = classRepository.save(OnlineClass.forStudent(teacher, "event-2",
                "binding-2", "Maths", START, END, student));

        // The document id is scoped to its class; presenting it against a
        // different class must not resolve.
        assertThatThrownBy(() -> annotationService.replay(
                teacherPrincipal, other.getId(), board.id(), 0))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void malformedGeometryIsRejectedBeforePersistence() {
        assertThatThrownBy(() -> draw(teacherPrincipal, "{\"kind\":\"pen\",\"points\":[[9,9]]}"))
                .isInstanceOf(ConflictException.class);

        assertThat(eventRepository.count()).isZero();
    }

    @Test
    void drawingOnAnEndedClassIsRejected() {
        onlineClass.end(Instant.now());
        classRepository.save(onlineClass);

        assertThatThrownBy(() -> draw(teacherPrincipal, PEN))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("ended");
    }

    // --- Snapshots -----------------------------------------------------------

    @Test
    void theTeacherSavesASnapshotAsALessonArtifact() {
        String png = Base64.getEncoder().encodeToString(new byte[] {1, 2, 3, 4});

        AnnotationDocumentResponse saved = annotationService.saveSnapshot(
                teacherPrincipal, onlineClass.getId(), board.id(), png);

        assertThat(saved.snapshotSavedAt()).isNotNull();
        org.mockito.Mockito.verify(storage).put(anyString(),
                org.mockito.ArgumentMatchers.any(byte[].class),
                org.mockito.ArgumentMatchers.eq("image/png"));
    }

    @Test
    void aDataUrlPrefixIsAccepted() {
        String png = "data:image/png;base64,"
                + Base64.getEncoder().encodeToString(new byte[] {1, 2, 3, 4});

        assertThat(annotationService.saveSnapshot(teacherPrincipal, onlineClass.getId(),
                board.id(), png).snapshotSavedAt()).isNotNull();
    }

    @Test
    void aStudentCannotSaveASnapshot() {
        String png = Base64.getEncoder().encodeToString(new byte[] {1, 2, 3, 4});

        assertThatThrownBy(() -> annotationService.saveSnapshot(
                studentPrincipal, onlineClass.getId(), board.id(), png))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anInvalidOrEmptySnapshotIsRejected() {
        assertThatThrownBy(() -> annotationService.saveSnapshot(
                teacherPrincipal, onlineClass.getId(), board.id(), "!!!not base64!!!"))
                .isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> annotationService.saveSnapshot(
                teacherPrincipal, onlineClass.getId(), board.id(), ""))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void savingWithoutStorageConfiguredIsReportedClearly() {
        when(storage.isConfigured()).thenReturn(false);
        String png = Base64.getEncoder().encodeToString(new byte[] {1, 2, 3, 4});

        assertThatThrownBy(() -> annotationService.saveSnapshot(
                teacherPrincipal, onlineClass.getId(), board.id(), png))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("storage");
    }
}
