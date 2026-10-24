package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.liveclasses.dto.AnnotationDocumentResponse;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * A student's personal board is private: only its owner and the teacher can
 * reach it, enforced from the target id on the server — not from the UI.
 */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class PersonalBoardAccessIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);
    private static final String PEN = "{\"kind\":\"pen\",\"width\":0.004,\"points\":[[0.1,0.2]]}";

    @Autowired
    private OnlineClassAnnotationService service;
    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private StudentGroupRepository groupRepository;
    @Autowired
    private StudentGroupMemberRepository groupMemberRepository;

    private AuthenticatedUser teacher;
    private AuthenticatedUser alice;
    private AuthenticatedUser bob;
    private UUID classId;
    private String aliceBoard;

    private static AuthenticatedUser principal(User user) {
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole());
    }

    @BeforeEach
    void seed() {
        User teacherUser = userRepository.save(User.invitedTeacher("Teacher", "t@test.local", "t1", END));
        User aliceUser = userRepository.save(User.invitedStudent("Alice", "a@test.local", teacherUser, "s1", END));
        User bobUser = userRepository.save(User.invitedStudent("Bob", "b@test.local", teacherUser, "s2", END));
        StudentGroup group = groupRepository.save(StudentGroup.create(teacherUser, "Group"));
        groupMemberRepository.save(StudentGroupMember.create(group, aliceUser));
        groupMemberRepository.save(StudentGroupMember.create(group, bobUser));

        OnlineClass created = OnlineClass.forGroup(teacherUser, "event-pb", "binding-pb", "Maths", START, END, group);
        created.start(START);
        OnlineClass savedClass = classRepository.save(created);
        classId = savedClass.getId();
        ClassTestSupport.admit(participantRepository, savedClass, aliceUser);
        ClassTestSupport.admit(participantRepository, savedClass, bobUser);

        teacher = principal(teacherUser);
        alice = principal(aliceUser);
        bob = principal(bobUser);
        aliceBoard = PersonalBoard.targetIdFor(aliceUser.getId());
    }

    private AnnotationDocumentResponse open(AuthenticatedUser who, String targetId) {
        return service.openDocument(who, classId, AnnotationTargetType.WHITEBOARD, targetId, 0, null, null);
    }

    private void draw(AuthenticatedUser who, UUID documentId) {
        service.append(who, classId, documentId,
                new AnnotationOperationRequest(UUID.randomUUID(), AnnotationOperationType.ADD, PEN));
    }

    @Test
    void theOwnerAndTheTeacherCanUseAPersonalBoard() {
        AnnotationDocumentResponse mine = open(alice, aliceBoard);
        draw(alice, mine.id());
        draw(teacher, mine.id());

        assertThat(service.replay(alice, classId, mine.id(), 0)).hasSize(2);
        assertThat(service.replay(teacher, classId, mine.id(), 0)).hasSize(2);
        assertThat(open(teacher, aliceBoard).id()).isEqualTo(mine.id());
    }

    @Test
    void anotherStudentCannotOpenItEvenKnowingTheId() {
        assertThatThrownBy(() -> open(bob, aliceBoard)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anotherStudentCannotReadOrWriteItEvenKnowingTheDocumentId() {
        UUID documentId = open(alice, aliceBoard).id();
        draw(alice, documentId);

        assertThatThrownBy(() -> service.replay(bob, classId, documentId, 0))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> draw(bob, documentId)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aNotebookCameraPersonalSurfaceIsPrivateAndSeparateFromTheOrdinaryBoard() {
        AnnotationDocumentResponse notebook = service.openDocument(alice, classId,
                AnnotationTargetType.NOTEBOOK_CAMERA, aliceBoard, 0, 1920, 1080);
        AnnotationDocumentResponse ordinaryBoard = open(alice, aliceBoard);

        assertThat(notebook.id()).isNotEqualTo(ordinaryBoard.id());
        assertThat(service.openDocument(teacher, classId, AnnotationTargetType.NOTEBOOK_CAMERA,
                aliceBoard, 0, null, null).id()).isEqualTo(notebook.id());
        draw(alice, notebook.id());
        draw(teacher, notebook.id());

        assertThat(service.replay(alice, classId, notebook.id(), 0)).hasSize(2);
        assertThat(service.replay(teacher, classId, notebook.id(), 0)).hasSize(2);
        assertThat(service.replay(alice, classId, ordinaryBoard.id(), 0)).isEmpty();
        draw(alice, ordinaryBoard.id());
        assertThat(service.replay(teacher, classId, ordinaryBoard.id(), 0)).hasSize(1);
        assertThat(service.replay(teacher, classId, notebook.id(), 0)).hasSize(2);

        assertThatThrownBy(() -> service.openDocument(bob, classId,
                AnnotationTargetType.NOTEBOOK_CAMERA, aliceBoard, 0, null, null))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.replay(bob, classId, notebook.id(), 0))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> draw(bob, notebook.id()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(service.listDocuments(bob, classId))
                .extracting(AnnotationDocumentResponse::id).doesNotContain(notebook.id());
        assertThat(service.listDocuments(alice, classId))
                .extracting(AnnotationDocumentResponse::id).contains(notebook.id());
        assertThat(service.listDocuments(teacher, classId))
                .extracting(AnnotationDocumentResponse::id).contains(notebook.id());
    }

    @Test
    void aPersonalBoardIsNotEvenListedForOtherStudents() {
        open(alice, aliceBoard);
        open(teacher, "board-1");

        List<String> seenByBob = service.listDocuments(bob, classId).stream()
                .map(AnnotationDocumentResponse::targetId).toList();
        List<String> seenByAlice = service.listDocuments(alice, classId).stream()
                .map(AnnotationDocumentResponse::targetId).toList();
        List<String> seenByTeacher = service.listDocuments(teacher, classId).stream()
                .map(AnnotationDocumentResponse::targetId).toList();

        assertThat(seenByBob).containsExactly("board-1");
        assertThat(seenByAlice).containsExactlyInAnyOrder("board-1", aliceBoard);
        assertThat(seenByTeacher).containsExactlyInAnyOrder("board-1", aliceBoard);
    }

    @Test
    void aMalformedPersonalIdIsTeacherOnly() {
        assertThatThrownBy(() -> open(alice, "personal-not-a-uuid")).isInstanceOf(ResourceNotFoundException.class);
        assertThat(open(teacher, "personal-not-a-uuid").targetId()).isEqualTo("personal-not-a-uuid");
    }

    @Test
    void theSharedBoardRemainsOpenToEveryone() {
        UUID shared = open(teacher, "board-1").id();

        assertThat(open(bob, "board-1").id()).isEqualTo(shared);
        draw(bob, shared);
        assertThat(service.replay(alice, classId, shared, 0)).hasSize(1);
    }
}
