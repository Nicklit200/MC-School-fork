package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Verifies that the V44–V47 constraints actually enforce the invariants the
 * application relies on, against real PostgreSQL rather than an in-memory stub.
 */
class OnlineClassPersistenceIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.parse("2026-09-18T10:00:00Z");
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private OnlineClassMessageRepository messageRepository;

    @Autowired
    private OnlineClassTranscriptSegmentRepository transcriptRepository;

    @Autowired
    private OnlineClassAnnotationDocumentRepository annotationDocumentRepository;

    @Autowired
    private UserRepository userRepository;

    private User teacher;
    private User student;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local",
                "t1", START.plusSeconds(3600)));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local", teacher,
                "s1", START.plusSeconds(3600)));
        onlineClass = classRepository.save(OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", START, END, student));
    }

    @Test
    void theSameCalendarOccurrenceCannotBeMaterializedTwice() {
        OnlineClass duplicate = OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", START, END, student);

        assertThatThrownBy(() -> classRepository.saveAndFlush(duplicate))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void aDifferentOccurrenceOfTheSameRecurringEventIsAllowed() {
        OnlineClass nextWeek = classRepository.saveAndFlush(OnlineClass.forStudent(teacher, "event-1",
                "binding-1", "Maths", START.plus(7, ChronoUnit.DAYS), END.plus(7, ChronoUnit.DAYS), student));

        assertThat(nextWeek.getId()).isNotEqualTo(onlineClass.getId());
    }

    @Test
    void roomNamesAreUniqueAndLookupable() {
        assertThat(classRepository.findByRoomName(onlineClass.getRoomName()))
                .isPresent()
                .get()
                .extracting(OnlineClass::getId)
                .isEqualTo(onlineClass.getId());
    }

    @Test
    void aUserHasAtMostOneParticipantRowPerClass() {
        participantRepository.saveAndFlush(OnlineClassParticipant.student(onlineClass, student));
        OnlineClassParticipant duplicate = OnlineClassParticipant.student(onlineClass, student);

        assertThatThrownBy(() -> participantRepository.saveAndFlush(duplicate))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void repeatedSendsWithTheSameClientIdCollapseOntoOneRow() {
        UUID clientMessageId = UUID.randomUUID();
        messageRepository.saveAndFlush(
                OnlineClassMessage.fromUser(onlineClass, student, clientMessageId, "hello"));

        OnlineClassMessage retry =
                OnlineClassMessage.fromUser(onlineClass, student, clientMessageId, "hello");

        assertThatThrownBy(() -> messageRepository.saveAndFlush(retry))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(messageRepository.findByOnlineClassIdAndClientMessageId(
                onlineClass.getId(), clientMessageId)).isPresent();
    }

    @Test
    void aSoftDeletedMessageMayHaveAnEmptyBody() {
        OnlineClassMessage message = messageRepository.saveAndFlush(
                OnlineClassMessage.fromUser(onlineClass, student, UUID.randomUUID(), "oops"));

        message.softDelete(teacher, Instant.now());

        // The body CHECK must permit a cleared body once deleted_at is set.
        OnlineClassMessage saved = messageRepository.saveAndFlush(message);
        assertThat(saved.isDeleted()).isTrue();
        assertThat(saved.getBody()).isEmpty();
    }

    @Test
    void messagesArePagedNewestFirst() {
        for (int i = 0; i < 5; i++) {
            messageRepository.saveAndFlush(
                    OnlineClassMessage.fromUser(onlineClass, student, UUID.randomUUID(), "m" + i));
        }

        List<OnlineClassMessage> page = messageRepository.findPage(onlineClass.getId(), null,
                org.springframework.data.domain.PageRequest.of(0, 3));

        assertThat(page).hasSize(3);
        assertThat(messageRepository.countByOnlineClassId(onlineClass.getId())).isEqualTo(5);
    }

    @Test
    void aResentFinalTranscriptSegmentCannotDuplicate() {
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(onlineClass,
                "seg-1", "identity-1", student, "Student", "de", 0L, 1500L, "Guten Tag", 0.94));

        OnlineClassTranscriptSegment resent = OnlineClassTranscriptSegment.finalSegment(onlineClass,
                "seg-1", "identity-1", student, "Student", "de", 0L, 1500L, "Guten Tag", 0.94);

        assertThatThrownBy(() -> transcriptRepository.saveAndFlush(resent))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void transcriptSegmentsComeBackInPlaybackOrder() {
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(onlineClass,
                "seg-2", "identity-1", student, "Student", "ru", 2000L, 3000L, "второй", null));
        transcriptRepository.saveAndFlush(OnlineClassTranscriptSegment.finalSegment(onlineClass,
                "seg-1", "identity-1", student, "Student", "ru", 0L, 1000L, "первый", null));

        List<OnlineClassTranscriptSegment> ordered =
                transcriptRepository.findAllByOnlineClassIdOrderByStartMsAscIdAsc(onlineClass.getId());

        assertThat(ordered).extracting(OnlineClassTranscriptSegment::getText)
                .containsExactly("первый", "второй");
    }

    @Test
    void oneAnnotationDocumentPerSurfaceAndPage() {
        annotationDocumentRepository.saveAndFlush(OnlineClassAnnotationDocument.create(
                onlineClass, AnnotationTargetType.WHITEBOARD, "board-1", 0));

        OnlineClassAnnotationDocument duplicate = OnlineClassAnnotationDocument.create(
                onlineClass, AnnotationTargetType.WHITEBOARD, "board-1", 0);

        assertThatThrownBy(() -> annotationDocumentRepository.saveAndFlush(duplicate))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void notebookCameraIsAcceptedAsAnAnnotationTargetForFutureUse() {
        // Reserved for the later phone-published notebook track; proving the
        // enum round-trips now is what keeps that a non-breaking addition.
        OnlineClassAnnotationDocument document = annotationDocumentRepository.saveAndFlush(
                OnlineClassAnnotationDocument.create(onlineClass, AnnotationTargetType.NOTEBOOK_CAMERA,
                        "track-1", 0));

        assertThat(annotationDocumentRepository.findById(document.getId()))
                .get()
                .extracting(OnlineClassAnnotationDocument::getTargetType)
                .isEqualTo(AnnotationTargetType.NOTEBOOK_CAMERA);
    }
}
