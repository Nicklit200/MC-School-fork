package com.mcschool.flashcard.students;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.study.StudySessionItemRepository;
import com.mcschool.flashcard.study.StudySessionRepository;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.StudentInvitationResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class StudentServiceTest {

    private final UserRepository userRepository = mock(UserRepository.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final StudySessionRepository studySessionRepository = mock(StudySessionRepository.class);
    private final StudySessionItemRepository studySessionItemRepository = mock(StudySessionItemRepository.class);
    private final StudentService studentService = new StudentService(
            userRepository, notificationService, studySessionRepository, studySessionItemRepository);

    private final User teacherEntity = User.invitedTeacher("Teacher", "teacher@test.local",
            "token", Instant.now().plusSeconds(3600));
    private final AuthenticatedUser teacher =
            new AuthenticatedUser(teacherEntity.getId(), teacherEntity.getEmail(), Role.TEACHER);

    @Test
    void createStudentInvitesStudentOwnedByTheCallingTeacher() {
        when(userRepository.existsByEmail("student@test.local")).thenReturn(false);
        when(userRepository.findById(teacher.id())).thenReturn(Optional.of(teacherEntity));
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        StudentInvitationResponse response = studentService.createStudent(teacher,
                new CreateStudentRequest("Student One", "  Student@Test.local "));

        assertThat(response.student().role()).isEqualTo(Role.STUDENT);
        assertThat(response.student().status()).isEqualTo(UserStatus.INVITED);
        assertThat(response.student().email()).isEqualTo("student@test.local");
        assertThat(response.invitationToken()).isNotBlank();
        assertThat(response.invitationExpiresAt()).isAfter(Instant.now());
        verify(notificationService).sendInvitation(any(User.class), any(String.class));
    }

    @Test
    void createStudentRejectsDuplicateEmail() {
        when(userRepository.existsByEmail("student@test.local")).thenReturn(true);

        assertThatThrownBy(() -> studentService.createStudent(teacher,
                new CreateStudentRequest("Student One", "student@test.local")))
                .isInstanceOf(ConflictException.class);

        verify(userRepository, never()).save(any());
        verify(notificationService, never()).sendInvitation(any(), any());
    }

    @Test
    void listStudentsQueriesOnlyTheCallingTeachersStudents() {
        User student = User.invitedStudent("Student One", "student@test.local", teacherEntity,
                "token2", Instant.now().plusSeconds(3600));
        when(userRepository.findAllByTeacherIdOrderByFullNameAsc(teacher.id()))
                .thenReturn(List.of(student));

        var students = studentService.listStudents(teacher);

        assertThat(students).hasSize(1);
        assertThat(students.get(0).email()).isEqualTo("student@test.local");
        verify(userRepository).findAllByTeacherIdOrderByFullNameAsc(teacher.id());
    }
}
