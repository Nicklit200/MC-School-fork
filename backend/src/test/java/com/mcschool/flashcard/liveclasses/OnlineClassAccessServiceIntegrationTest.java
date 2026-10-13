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
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Authorization matrix for online classes.
 *
 * <p>Access must be derived from database ownership/binding only. Denials are
 * asserted as not-found so an outsider cannot tell an existing-but-forbidden
 * class from a non-existent one.
 */
class OnlineClassAccessServiceIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.parse("2026-09-18T10:00:00Z");
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassAccessService accessService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private StudentGroupRepository groupRepository;

    @Autowired
    private StudentGroupMemberRepository groupMemberRepository;

    private User teacher;
    private User otherTeacher;
    private User boundStudent;
    private User otherStudent;
    private User parent;
    private OnlineClass directClass;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local",
                "t1", START.plusSeconds(3600)));
        otherTeacher = userRepository.save(User.invitedTeacher("Other", "other@test.local",
                "t2", START.plusSeconds(3600)));
        boundStudent = userRepository.save(User.invitedStudent("Bound", "bound@test.local", teacher,
                "s1", START.plusSeconds(3600)));
        otherStudent = userRepository.save(User.invitedStudent("Outsider", "outsider@test.local", teacher,
                "s2", START.plusSeconds(3600)));
        parent = userRepository.save(User.invitedParent("Parent", "parent@test.local",
                "p1", START.plusSeconds(3600)));
        directClass = classRepository.save(OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", START, END, boundStudent));
    }

    private AuthenticatedUser principal(User user) {
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole());
    }

    @Test
    void owningTeacherIsTheHost() {
        OnlineClass found = accessService.requireHost(principal(teacher), directClass.getId());

        assertThat(found.getId()).isEqualTo(directClass.getId());
        assertThat(accessService.isHost(principal(teacher), directClass)).isTrue();
    }

    @Test
    void boundStudentMayParticipateButIsNotHost() {
        OnlineClass found = accessService.requireParticipant(principal(boundStudent), directClass.getId());

        assertThat(found.getId()).isEqualTo(directClass.getId());
        assertThat(accessService.isHost(principal(boundStudent), directClass)).isFalse();
        assertThatThrownBy(() -> accessService.requireHost(principal(boundStudent), directClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anotherTeacherCannotReachTheClass() {
        assertThatThrownBy(() -> accessService.requireParticipant(principal(otherTeacher), directClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("not found");
        assertThatThrownBy(() -> accessService.requireHost(principal(otherTeacher), directClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anUnrelatedStudentCannotReachTheClass() {
        assertThatThrownBy(() -> accessService.requireParticipant(principal(otherStudent), directClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void parentsDoNotJoinClassesInThisRelease() {
        assertThat(accessService.canParticipate(principal(parent), directClass)).isFalse();
        assertThatThrownBy(() -> accessService.requireParticipant(principal(parent), directClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void anArchivedStudentCannotJoin() {
        boundStudent.archive();
        userRepository.save(boundStudent);

        assertThat(accessService.canParticipate(principal(boundStudent), directClass)).isFalse();
    }

    @Test
    void anArchivedTeacherIsNoLongerHost() {
        teacher.archive();
        userRepository.save(teacher);

        assertThat(accessService.isHost(principal(teacher), directClass)).isFalse();
    }

    @Test
    void activeGroupMembersMayJoinAGroupClass() {
        StudentGroup group = groupRepository.save(StudentGroup.create(teacher, "Group A"));
        groupMemberRepository.save(StudentGroupMember.create(group, boundStudent));
        OnlineClass groupClass = classRepository.save(OnlineClass.forGroup(teacher, "event-2", "binding-2",
                "Maths", START, END, group));

        assertThat(accessService.canParticipate(principal(boundStudent), groupClass)).isTrue();
        // A student who is not a member of that group must not get in.
        assertThat(accessService.canParticipate(principal(otherStudent), groupClass)).isFalse();
        assertThatThrownBy(() -> accessService.requireParticipant(principal(otherStudent), groupClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aMissingClassIsReportedTheSameWayAsAForbiddenOne() {
        java.util.UUID unknown = java.util.UUID.randomUUID();

        assertThatThrownBy(() -> accessService.requireParticipant(principal(teacher), unknown))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Online class not found");
    }

    @Test
    void requireActiveUserRejectsArchivedAccounts() {
        otherStudent.archive();
        userRepository.save(otherStudent);

        assertThatThrownBy(() -> accessService.requireActiveUser(otherStudent.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(accessService.requireActiveUser(teacher.getId()).getRole()).isEqualTo(Role.TEACHER);
    }
}
