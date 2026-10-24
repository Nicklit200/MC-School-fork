package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.*;
import com.mcschool.flashcard.lessons.dto.CreateLessonRequest;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.*;
import jakarta.validation.Validation;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class ManualLessonServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final LessonHistoryRepository history = mock(LessonHistoryRepository.class);
    private final ManualLessonService service = new ManualLessonService(users, groups, members, history);
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "unused");
    private final AuthenticatedUser caller = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.TEACHER);
    private final Instant start = Instant.parse("2026-11-10T14:00:00Z");

    @BeforeEach
    void setUp() {
        when(users.findById(teacher.getId())).thenReturn(Optional.of(teacher));
    }

    private CreateLessonRequest request(UUID group, UUID student) {
        return new CreateLessonRequest("  Fractions  ", start, start.plusSeconds(3600), group, student);
    }

    @Test
    void createsDurableUnassignedLessonWithoutGoogle() {
        GroupLessonResponse lesson = service.create(caller, request(null, null));
        assertThat(lesson.title()).isEqualTo("Fractions");
        assertThat(lesson.eventId()).startsWith("local-");
        assertThat(lesson.bindingKey()).isEqualTo(lesson.eventId());
        assertThat(lesson.meetUrl()).isNull();
        assertThat(lesson.calendarUrl()).isNull();
        var saved = org.mockito.ArgumentCaptor.forClass(LessonHistoryEntry.class);
        verify(history).save(saved.capture());
        assertThat(saved.getValue().getTeacher()).isSameAs(teacher);
        assertThat(saved.getValue().toResponse()).isEqualTo(lesson);
        verifyNoInteractions(groups, members);
    }

    @Test
    void createsIndividualLessonOnlyForOwnStudent() {
        User student = User.managedStudent("Student", teacher);
        when(users.findById(student.getId())).thenReturn(Optional.of(student));
        var lesson = service.create(caller, request(null, student.getId()));
        assertThat(lesson.studentName()).isEqualTo("Student");
        assertThat(lesson.participantStudentIds()).containsExactly(student.getId());
    }

    @Test
    void snapshotsOwnGroupMembers() {
        StudentGroup group = StudentGroup.create(teacher, "Group 1");
        User own = User.managedStudent("Own", teacher);
        User archived = User.managedStudent("Archived", teacher);
        archived.archive();
        User foreign = User.managedStudent("Foreign", User.activeTeacher("Other", "other@test.local", "other", "unused"));
        when(groups.findByIdAndTeacherId(group.getId(), teacher.getId())).thenReturn(Optional.of(group));
        when(members.findAllByGroupIdOrderByCreatedAtAsc(group.getId())).thenReturn(List.of(
                StudentGroupMember.create(group, own), StudentGroupMember.create(group, archived), StudentGroupMember.create(group, foreign)));
        var lesson = service.create(caller, request(group.getId(), null));
        assertThat(lesson.groupName()).isEqualTo("Group 1");
        assertThat(lesson.participantStudentIds()).containsExactly(own.getId());
    }

    @Test
    void rejectsForeignStudentWithoutSaving() {
        User foreign = User.managedStudent("Foreign", User.activeTeacher("Other", "other@test.local", "other", "unused"));
        when(users.findById(foreign.getId())).thenReturn(Optional.of(foreign));
        assertThatThrownBy(() -> service.create(caller, request(null, foreign.getId())))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(history);
    }

    @Test
    void rejectsForeignGroupWithoutSaving() {
        assertThatThrownBy(() -> service.create(caller, request(UUID.randomUUID(), null)))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(history);
    }

    @Test
    void rejectsInvalidTimeRangeOrBothTargets() {
        assertThatThrownBy(() -> service.create(caller,
                new CreateLessonRequest("Lesson", start, start, null, null)))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.create(caller, request(UUID.randomUUID(), UUID.randomUUID())))
                .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(history);
    }

    @Test
    void rejectsArchivedTeacherAndWrongCallerRole() {
        teacher.archive();
        assertThatThrownBy(() -> service.create(caller, request(null, null)))
                .isInstanceOf(ResourceNotFoundException.class);
        var admin = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.ADMIN);
        assertThatThrownBy(() -> service.create(admin, request(null, null)))
                .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(history);
    }

    @Test
    void reassigningLocalLessonReplacesPreviousEnrollment() {
        User previous = User.managedStudent("Previous", teacher);
        User next = User.managedStudent("Next", teacher);
        when(users.findById(previous.getId())).thenReturn(Optional.of(previous));
        when(users.findById(next.getId())).thenReturn(Optional.of(next));
        GroupLessonResponse lesson = service.create(caller, request(null, previous.getId()));
        LessonHistoryEntry entry = LessonHistoryEntry.create(teacher, lesson);
        when(history.findByTeacherIdAndEventId(teacher.getId(), lesson.eventId())).thenReturn(Optional.of(entry));
        service.bindStudent(caller, lesson.eventId(), next.getId());
        assertThat(entry.toResponse().studentId()).isEqualTo(next.getId());
        assertThat(entry.toResponse().participantStudentIds()).containsExactly(next.getId());
    }

    @Test
    void cannotReassignAnotherTeachersLesson() {
        assertThatThrownBy(() -> service.bindStudent(caller, "local-unknown", UUID.randomUUID()))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(history, never()).save(any());
    }

    @Test
    void scheduleReturnsManualAndImportedHistoryWhenGoogleIsDisconnected() {
        var lesson = service.create(caller, request(null, null));
        var imported = new GroupLessonResponse("google-event", "google-event", null, null, null, null,
                List.of(), "Imported", start.minusSeconds(3600), start, null, "https://calendar.google.com/");
        when(history.findAllByTeacherIdOrderByStartsAtAsc(teacher.getId())).thenReturn(List.of(
                LessonHistoryEntry.create(teacher, lesson), LessonHistoryEntry.create(teacher, imported)));
        var oauth = mock(GoogleCalendarOAuthService.class);
        var meet = mock(GoogleMeetEventsService.class);
        var calendar = new GoogleCalendarLessonService(new ObjectMapper(), groups, members, users, history,
                mock(GoogleCalendarLessonBindingRepository.class), oauth, meet);
        assertThat(calendar.listGroupLessons(caller)).extracting(GroupLessonResponse::title)
                .containsExactly("Imported", "Fractions");
        verifyNoInteractions(meet);
    }

    @Test
    void googleRefreshFailureDoesNotHideNativeLessons() {
        var lesson = service.create(caller, request(null, null));
        when(history.findAllByTeacherIdOrderByStartsAtAsc(teacher.getId()))
                .thenReturn(List.of(LessonHistoryEntry.create(teacher, lesson)));
        var oauth = mock(GoogleCalendarOAuthService.class);
        when(oauth.accessTokenForTeacher(teacher.getId())).thenThrow(new IllegalStateException("Expired connection"));
        var calendar = new GoogleCalendarLessonService(new ObjectMapper(), groups, members, users, history,
                mock(GoogleCalendarLessonBindingRepository.class), oauth, mock(GoogleMeetEventsService.class));
        assertThat(calendar.listGroupLessons(caller)).containsExactly(lesson);
    }

    @Test
    void requestValidationRejectsBlankTitleMissingTimesAndInvalidTargets() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertThat(validator.validate(new CreateLessonRequest(" ", null, null, null, null))).hasSize(3);
            assertThat(validator.validate(new CreateLessonRequest("Lesson", start, start.minusSeconds(60), UUID.randomUUID(), UUID.randomUUID())))
                    .hasSize(2);
            assertThat(validator.validate(request(null, null))).isEmpty();
        }
    }
}
