package com.mcschool.flashcard.students;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryService;
import com.mcschool.flashcard.students.dto.CreateStudentRequest;
import com.mcschool.flashcard.students.dto.UpdateStudentUsernameRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.StudentUsernames;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

class StudentUsernameTest {
    private final UserRepository users = mock(UserRepository.class);
    private final User teacher = User.activeTeacher("Teacher", "teacher@example.test", "teacher", "hash");
    private final AuthenticatedUser caller = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.TEACHER);
    private final StudentService service = new StudentService(users, mock(CardRepository.class),
            mock(NotificationService.class), mock(DailyReviewHistoryService.class),
            mock(PasswordEncoder.class), "Europe/Berlin");

    @Test
    void transliteratesCyrillicAndAccents() {
        assertThat(StudentUsernames.base("Себастьян")).isEqualTo("sebastyan");
        assertThat(StudentUsernames.base("Максим")).isEqualTo("maksim");
        assertThat(StudentUsernames.base("София")).isEqualTo("sofiya");
        assertThat(StudentUsernames.base("Віталіна")).isEqualTo("vitalina");
        assertThat(StudentUsernames.base("Émilie")).isEqualTo("emilie");
        assertThat(StudentUsernames.base("123")).isEqualTo("student123");
        assertThat(StudentUsernames.base("中文")).isEqualTo("student");
    }

    @Test
    void generatesLatinLoginForNewStudent() {
        when(users.findById(teacher.getId())).thenReturn(Optional.of(teacher));
        when(users.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        var result = service.createStudent(caller, new CreateStudentRequest("Себастьян", null));
        assertThat(result.student().username()).matches("sebastyan[0-9]{3}");
    }

    @Test
    void changesLoginWithoutChangingIdentityOrPassword() {
        User student = User.managedStudent("Максим", teacher);
        student.assignUsername("Максим117");
        student.changePasswordHash("original-hash");
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        var result = service.updateStudentUsername(caller, student.getId(), new UpdateStudentUsernameRequest("maksim117"));
        assertThat(result.username()).isEqualTo("maksim117");
        assertThat(result.id()).isEqualTo(student.getId());
        assertThat(student.getFullName()).isEqualTo("Максим");
        assertThat(student.getPasswordHash()).isEqualTo("original-hash");
        verify(users).saveAndFlush(student);
    }

    @Test
    void rejectsDuplicatesAcrossRolesAndNonLatinLogins() {
        User student = User.managedStudent("Максим", teacher);
        student.assignUsername("Максим117");
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        when(users.findByUsernameIgnoreCase("Teacher")).thenReturn(Optional.of(teacher));
        assertThatThrownBy(() -> service.updateStudentUsername(caller, student.getId(), new UpdateStudentUsernameRequest("Teacher")))
                .isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> service.updateStudentUsername(caller, student.getId(), new UpdateStudentUsernameRequest("Максим123")))
                .isInstanceOf(ResponseStatusException.class);
        assertThat(student.getUsername()).isEqualTo("Максим117");
        verify(users, never()).saveAndFlush(any(User.class));
    }

    @Test
    void deniesAnotherTeachersStudent() {
        User other = User.activeTeacher("Other", "other@example.test", "other", "hash");
        User student = User.managedStudent("Максим", other);
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        assertThatThrownBy(() -> service.updateStudentUsername(caller, student.getId(), new UpdateStudentUsernameRequest("maksim117")))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(users, never()).saveAndFlush(any(User.class));
    }
}
