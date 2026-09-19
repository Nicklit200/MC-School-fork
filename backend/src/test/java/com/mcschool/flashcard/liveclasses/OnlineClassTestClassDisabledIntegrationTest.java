package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/** With the flag at its default, the escape hatch does not exist. */
@TestPropertySource(properties = "app.online-classes.enabled=true")
class OnlineClassTestClassDisabledIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private OnlineClassService service;

    @Autowired
    private UserRepository userRepository;

    @Test
    void isNotAvailableUnlessExplicitlyEnabled() {
        Instant later = Instant.now().plusSeconds(3600);
        User teacher = userRepository.save(User.invitedTeacher("Teacher", "t@test.local", "t1", later));
        User student = userRepository.save(
                User.invitedStudent("Mine", "mine@test.local", teacher, "s1", later));
        AuthenticatedUser caller =
                new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());

        // Default is false: production must not expose this.
        assertThatThrownBy(() -> service.createTestClass(caller, student.getId(), null, "Nope"))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
