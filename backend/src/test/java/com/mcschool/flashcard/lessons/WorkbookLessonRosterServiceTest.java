package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WorkbookLessonRosterServiceTest {
    private final LessonParticipantsService participants = mock(LessonParticipantsService.class);
    private final McpHomeworkSeriesService groups = mock(McpHomeworkSeriesService.class);
    private final WorkbookLessonRosterService service = new WorkbookLessonRosterService(participants, groups);
    private final UUID teacherId = UUID.randomUUID();
    private final AuthenticatedUser teacher = new AuthenticatedUser(teacherId, null, Role.TEACHER);
    private final UUID groupId = UUID.randomUUID();
    private final UUID vitalinaId = UUID.randomUUID();
    private final UUID semenId = UUID.randomUUID();

    private GroupLessonResponse groupLesson() {
        return new GroupLessonResponse("event-1", "binding-1", groupId, "Group 2",
                null, null, List.of(), "Group 2",
                Instant.parse("2026-11-27T17:00:00Z"),
                Instant.parse("2026-11-27T18:30:00Z"), null, null);
    }

    @Test
    void exactOccurrenceRosterWinsOverPermanentGroupMembers() {
        when(participants.hasLesson(teacherId, "event-1")).thenReturn(true);
        when(participants.list(teacher, "event-1")).thenReturn(List.of(
                new LessonParticipantsService.Participant(semenId, "Семён"),
                new LessonParticipantsService.Participant(vitalinaId, "Виталина")));

        var roster = service.resolve(teacher, groupLesson());

        assertThat(roster.source()).isEqualTo("LESSON_OCCURRENCE");
        assertThat(roster.needsTeacherReview()).isFalse();
        assertThat(roster.students()).extracting(WorkbookLessonRosterService.Student::id)
                .containsExactly(semenId, vitalinaId);
        verify(participants).list(teacher, "event-1");
    }

    @Test
    void explicitEmptyOccurrenceRosterDoesNotFallBackToPermanentGroupMembers() {
        when(participants.hasLesson(teacherId, "event-1")).thenReturn(true);
        when(participants.list(teacher, "event-1")).thenReturn(List.of());

        var roster = service.resolve(teacher, groupLesson());

        assertThat(roster.students()).isEmpty();
        assertThat(roster.source()).isEqualTo("LESSON_OCCURRENCE");
        assertThat(roster.needsTeacherReview()).isFalse();
    }

    @Test
    void legacyLessonUsesPermanentGroupMembersButFlagsTeacherReview() {
        when(participants.hasLesson(teacherId, "event-1")).thenReturn(false);
        when(groups.findTargets(teacher, "")).thenReturn(Map.of("targets", List.of(
                Map.of("type", "group", "id", groupId.toString(), "students", List.of(
                        Map.of("id", semenId.toString(), "name", "Семён"),
                        Map.of("id", vitalinaId.toString(), "name", "Виталина"))))));

        var roster = service.resolve(teacher, groupLesson());

        assertThat(roster.source()).isEqualTo("PERMANENT_GROUP_MEMBERSHIP_FALLBACK");
        assertThat(roster.needsTeacherReview()).isTrue();
        assertThat(roster.students()).extracting(WorkbookLessonRosterService.Student::id)
                .containsExactly(semenId, vitalinaId);
    }
}
