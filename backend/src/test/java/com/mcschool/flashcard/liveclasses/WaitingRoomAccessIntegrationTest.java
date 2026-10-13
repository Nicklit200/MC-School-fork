package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * Being bound to a class is not the same as being let in. A student who is
 * still in the waiting room, was declined, or was removed must not read the
 * chat, the roster or the board, or post to them.
 */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class WaitingRoomAccessIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassChatService chatService;

    @Autowired
    private OnlineClassAnnotationService annotationService;

    @Autowired
    private OnlineClassHostControlService hostControlService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private UserRepository userRepository;

    private User student;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        User teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local", "t1", END));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local", teacher, "s1", END));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        studentPrincipal = new AuthenticatedUser(student.getId(), student.getEmail(), student.getRole());

        OnlineClass created = OnlineClass.forStudent(teacher, "event-1", "binding-1", "Maths", START, END, student);
        created.start(START);
        onlineClass = classRepository.save(created);
    }

    private OnlineClassParticipant participantInState(String state) {
        OnlineClassParticipant participant =
                participantRepository.save(OnlineClassParticipant.student(onlineClass, student));
        switch (state) {
            case "ADMITTED" -> participant.admit();
            case "REJECTED" -> participant.reject();
            case "REMOVED" -> participant.remove();
            default -> { /* stays PENDING: the waiting room */ }
        }
        return participantRepository.save(participant);
    }

    private void assertShutOut() {
        UUID classId = onlineClass.getId();
        assertThatThrownBy(() -> chatService.send(studentPrincipal, classId, UUID.randomUUID(), "hello"))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> chatService.history(studentPrincipal, classId, null, 50))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> hostControlService.listParticipants(studentPrincipal, classId))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> annotationService.openDocument(
                studentPrincipal, classId, AnnotationTargetType.WHITEBOARD, "board-1", 0, null, null))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aStudentWhoHasNeverKnockedIsShutOut() {
        assertShutOut();
    }

    @Test
    void aStudentStillInTheWaitingRoomIsShutOut() {
        participantInState("PENDING");
        assertShutOut();
    }

    @Test
    void aDeclinedStudentIsShutOut() {
        participantInState("REJECTED");
        assertShutOut();
    }

    @Test
    void aRemovedStudentIsShutOut() {
        participantInState("REMOVED");
        assertShutOut();
    }

    @Test
    void anAdmittedStudentCanChatAndOpenTheBoard() {
        participantInState("ADMITTED");
        UUID classId = onlineClass.getId();

        assertThat(chatService.send(studentPrincipal, classId, UUID.randomUUID(), "hello").body()).isEqualTo("hello");
        assertThat(chatService.history(studentPrincipal, classId, null, 50).messages()).hasSize(1);
        assertThat(hostControlService.listParticipants(studentPrincipal, classId)).isNotEmpty();
        assertThat(annotationService.openDocument(
                studentPrincipal, classId, AnnotationTargetType.WHITEBOARD, "board-1", 0, null, null)).isNotNull();
    }

    @Test
    void theTeacherNeverNeedsAdmitting() {
        UUID classId = onlineClass.getId();
        assertThat(chatService.send(teacherPrincipal, classId, UUID.randomUUID(), "welcome").body()).isEqualTo("welcome");
        assertThat(annotationService.openDocument(
                teacherPrincipal, classId, AnnotationTargetType.WHITEBOARD, "board-1", 0, null, null)).isNotNull();
    }
}
