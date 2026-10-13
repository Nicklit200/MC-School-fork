package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.OnlineClassResponse;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * The Calendar-free test-class escape hatch.
 *
 * <p>It exists so QA can exercise the feature without Google Calendar, so the
 * tests that matter are the ones proving it grants nothing extra.
 */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.allow-test-classes=true"
})
class OnlineClassTestClassIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private OnlineClassService service;

    @Autowired
    private UserRepository userRepository;

    private User teacher;
    private User otherTeacher;
    private User myStudent;
    private User theirStudent;
    private AuthenticatedUser teacherPrincipal;

    @BeforeEach
    void seed() {
        Instant later = Instant.now().plusSeconds(3600);
        teacher = userRepository.save(User.invitedTeacher("Teacher", "t@test.local", "t1", later));
        otherTeacher = userRepository.save(User.invitedTeacher("Other", "o@test.local", "t2", later));
        myStudent = userRepository.save(User.invitedStudent("Mine", "mine@test.local", teacher, "s1", later));
        theirStudent = userRepository.save(
                User.invitedStudent("Theirs", "theirs@test.local", otherTeacher, "s2", later));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
    }

    @Test
    void createsAClassBoundToTheTeachersOwnStudent() {
        OnlineClassResponse created =
                service.createTestClass(teacherPrincipal, myStudent.getId(), null, "QA class");

        assertThat(created.studentId()).isEqualTo(myStudent.getId());
        assertThat(created.title()).isEqualTo("QA class");
        assertThat(created.viewerIsHost()).isTrue();
        // Immediately joinable so a tester is not left waiting.
        assertThat(created.joinWindowOpen()).isTrue();
    }

    @Test
    void repeatedCallsDoNotCollideOnTheOccurrenceIndex() {
        OnlineClassResponse first =
                service.createTestClass(teacherPrincipal, myStudent.getId(), null, "One");
        OnlineClassResponse second =
                service.createTestClass(teacherPrincipal, myStudent.getId(), null, "Two");

        assertThat(second.id()).isNotEqualTo(first.id());
    }

    @Test
    void cannotBindAnotherTeachersStudent() {
        // The escape hatch must not become a way to reach someone else's pupil.
        assertThatThrownBy(() ->
                service.createTestClass(teacherPrincipal, theirStudent.getId(), null, "Nope"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aStudentCannotCreateOne() {
        AuthenticatedUser studentPrincipal = new AuthenticatedUser(
                myStudent.getId(), myStudent.getEmail(), myStudent.getRole());

        assertThatThrownBy(() ->
                service.createTestClass(studentPrincipal, myStudent.getId(), null, "Nope"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void requiresAStudentOrGroup() {
        assertThatThrownBy(() -> service.createTestClass(teacherPrincipal, null, null, "Nope"))
                .isInstanceOf(RuntimeException.class);
    }
}
