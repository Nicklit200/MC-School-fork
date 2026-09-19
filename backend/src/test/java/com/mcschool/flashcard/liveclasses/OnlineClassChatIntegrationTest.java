package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.ChatMessageResponse;
import com.mcschool.flashcard.liveclasses.dto.ChatPageResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/** Persistent chat: idempotency, ordering, pagination, authorization, limits. */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class OnlineClassChatIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassChatService chatService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassMessageRepository messageRepository;

    @Autowired
    private UserRepository userRepository;

    private User teacher;
    private User student;
    private User outsider;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;
    private OnlineClass onlineClass;

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
    }

    private ChatMessageResponse send(AuthenticatedUser caller, String body) {
        return chatService.send(caller, onlineClass.getId(), UUID.randomUUID(), body);
    }

    // --- Idempotency and ordering --------------------------------------------

    @Test
    void aRetriedSendReturnsTheOriginalMessage() {
        UUID clientMessageId = UUID.randomUUID();

        ChatMessageResponse first =
                chatService.send(studentPrincipal, onlineClass.getId(), clientMessageId, "hello");
        ChatMessageResponse retry =
                chatService.send(studentPrincipal, onlineClass.getId(), clientMessageId, "hello");

        assertThat(retry.id()).isEqualTo(first.id());
        assertThat(messageRepository.countByOnlineClassId(onlineClass.getId())).isEqualTo(1);
    }

    @Test
    void historyIsOldestFirstWithinAPage() {
        send(studentPrincipal, "first");
        send(studentPrincipal, "second");
        send(teacherPrincipal, "third");

        ChatPageResponse page = chatService.history(studentPrincipal, onlineClass.getId(), null, null);

        assertThat(page.messages()).extracting(ChatMessageResponse::body)
                .containsExactly("first", "second", "third");
        assertThat(page.hasMore()).isFalse();
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void paginationWalksBackwardsThroughHistory() {
        for (int i = 0; i < 5; i++) {
            send(studentPrincipal, "m" + i);
        }

        ChatPageResponse newest = chatService.history(studentPrincipal, onlineClass.getId(), null, 2);
        assertThat(newest.messages()).extracting(ChatMessageResponse::body).containsExactly("m3", "m4");
        assertThat(newest.hasMore()).isTrue();

        ChatPageResponse older = chatService.history(
                studentPrincipal, onlineClass.getId(), newest.nextCursor(), 2);
        assertThat(older.messages()).extracting(ChatMessageResponse::body).containsExactly("m1", "m2");

        ChatPageResponse oldest = chatService.history(
                studentPrincipal, onlineClass.getId(), older.nextCursor(), 2);
        assertThat(oldest.messages()).extracting(ChatMessageResponse::body).containsExactly("m0");
        assertThat(oldest.hasMore()).isFalse();
    }

    // --- Authorization -------------------------------------------------------

    @Test
    void anOutsiderCanNeitherReadNorPost() {
        send(studentPrincipal, "private");
        AuthenticatedUser intruder =
                new AuthenticatedUser(outsider.getId(), outsider.getEmail(), outsider.getRole());

        assertThatThrownBy(() -> chatService.history(intruder, onlineClass.getId(), null, null))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> send(intruder, "intruding"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aParticipantCannotEditSomeoneElsesMessage() {
        ChatMessageResponse theirs = send(teacherPrincipal, "teacher message");

        // Reported as not-found so one participant cannot probe for another's
        // message by id.
        assertThatThrownBy(() ->
                chatService.edit(studentPrincipal, onlineClass.getId(), theirs.id(), "hacked"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anAuthorMayEditTheirOwnMessage() {
        ChatMessageResponse mine = send(studentPrincipal, "typo");

        ChatMessageResponse edited =
                chatService.edit(studentPrincipal, onlineClass.getId(), mine.id(), "fixed");

        assertThat(edited.body()).isEqualTo("fixed");
        assertThat(edited.editedAt()).isNotNull();
    }

    @Test
    void anAuthorMayDeleteTheirOwnMessage() {
        ChatMessageResponse mine = send(studentPrincipal, "oops");

        ChatMessageResponse deleted =
                chatService.delete(studentPrincipal, onlineClass.getId(), mine.id());

        assertThat(deleted.deleted()).isTrue();
        assertThat(deleted.body()).isEmpty();
    }

    @Test
    void theHostMayDeleteAnyMessage() {
        ChatMessageResponse theirs = send(studentPrincipal, "inappropriate");

        ChatMessageResponse deleted =
                chatService.delete(teacherPrincipal, onlineClass.getId(), theirs.id());

        assertThat(deleted.deleted()).isTrue();
    }

    @Test
    void aStudentCannotDeleteAnotherStudentsMessage() {
        ChatMessageResponse theirs = send(teacherPrincipal, "teacher message");

        assertThatThrownBy(() ->
                chatService.delete(studentPrincipal, onlineClass.getId(), theirs.id()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- Content rules -------------------------------------------------------

    @Test
    void markupIsStoredVerbatimAsTextAndNotInterpreted() {
        String payload = "<script>alert('x')</script>";

        ChatMessageResponse sent = send(studentPrincipal, payload);

        // Stored exactly as typed: escaping happens at render time, so escaping
        // here as well would corrupt legitimate '<' and '&' characters.
        assertThat(sent.body()).isEqualTo(payload);
        assertThat(sent.messageType()).isEqualTo(ClassMessageType.USER);
    }

    @Test
    void controlCharactersAreStripped() {
        ChatMessageResponse sent = send(studentPrincipal, "hel\000lo\007 there");

        assertThat(sent.body()).isEqualTo("hello there");
    }

    @Test
    void blankAndWhitespaceOnlyMessagesAreRejected() {
        assertThatThrownBy(() -> send(studentPrincipal, "   \n  "))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void aMessageCannotExceedTheMaximumLength() {
        assertThatThrownBy(() -> send(studentPrincipal, "a".repeat(2001)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void sendingTooFastIsRateLimited() {
        for (int i = 0; i < OnlineClassChatService.RATE_LIMIT_MESSAGES; i++) {
            send(studentPrincipal, "m" + i);
        }

        assertThatThrownBy(() -> send(studentPrincipal, "one too many"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("too quickly");
    }

    @Test
    void theRateLimitIsPerSenderNotPerClass() {
        for (int i = 0; i < OnlineClassChatService.RATE_LIMIT_MESSAGES; i++) {
            send(studentPrincipal, "m" + i);
        }

        // The teacher is unaffected by the student hitting their own limit.
        assertThat(send(teacherPrincipal, "still fine").body()).isEqualTo("still fine");
    }

    @Test
    void aRetryIsNotPunishedByTheRateLimit() {
        UUID clientMessageId = UUID.randomUUID();
        chatService.send(studentPrincipal, onlineClass.getId(), clientMessageId, "hello");
        for (int i = 0; i < OnlineClassChatService.RATE_LIMIT_MESSAGES - 1; i++) {
            send(studentPrincipal, "m" + i);
        }

        // At the limit, but this is the same message again — it must resolve
        // from the idempotency key rather than being throttled.
        ChatMessageResponse retry =
                chatService.send(studentPrincipal, onlineClass.getId(), clientMessageId, "hello");

        assertThat(retry.body()).isEqualTo("hello");
    }

    @Test
    void postingToAnEndedClassIsRejected() {
        onlineClass.end(Instant.now());
        classRepository.save(onlineClass);

        assertThatThrownBy(() -> send(studentPrincipal, "after the bell"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("ended");
    }

    @Test
    void historyRemainsReadableAfterTheClassEnds() {
        send(studentPrincipal, "during class");
        onlineClass.end(Instant.now());
        classRepository.save(onlineClass);

        ChatPageResponse page = chatService.history(studentPrincipal, onlineClass.getId(), null, null);

        assertThat(page.messages()).hasSize(1);
    }

    @Test
    void aDeletedMessageCannotBeEdited() {
        ChatMessageResponse mine = send(studentPrincipal, "oops");
        chatService.delete(studentPrincipal, onlineClass.getId(), mine.id());

        assertThatThrownBy(() ->
                chatService.edit(studentPrincipal, onlineClass.getId(), mine.id(), "revived"))
                .isInstanceOf(IllegalStateException.class);
    }
}
