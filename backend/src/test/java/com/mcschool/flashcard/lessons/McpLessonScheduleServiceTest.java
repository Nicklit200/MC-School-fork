package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

class McpLessonScheduleServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final LessonHistoryRepository history = mock(LessonHistoryRepository.class);
    private final OnlineClassRepository rooms = mock(OnlineClassRepository.class);
    private final OnlineClassService classroom = mock(OnlineClassService.class);
    private final GoogleCalendarLessonService calendar = mock(GoogleCalendarLessonService.class);
    private final McpOperationReceiptService receipts = mock(McpOperationReceiptService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final McpAccessService access = new McpAccessService(jdbc);
    private final ManualLessonService nativeLessons = new ManualLessonService(users, groups, members, history, rooms, classroom, mock(org.springframework.context.ApplicationEventPublisher.class));
    private final McpLessonScheduleService service = new McpLessonScheduleService(nativeLessons, calendar, users, groups, history, access, receipts, jdbc);
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "unused");
    private final User other = User.activeTeacher("Other", "other@test.local", "other", "unused");
    private final User admin = User.bootstrapAdmin("Admin", "admin@test.local", "unused");
    private final User student = User.managedStudent("Pupil", teacher);
    private final Map<String, LessonHistoryEntry> entries = new LinkedHashMap<>();
    private Object writtenPrincipal;
    private Object writtenAudit;

    @BeforeEach
    @SuppressWarnings({"rawtypes", "unchecked"})
    void setup() {
        for (User user : List.of(teacher, other, admin, student)) when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(jdbc.query(anyString(), any(RowMapper.class), any(UUID.class))).thenAnswer(invocation -> {
            User user = users.findById(invocation.getArgument(2)).orElse(null);
            return user == null ? List.of() : List.of(new McpAccessService.Account(user.getId(), user.getEmail(), user.getRole(), user.getStatus(), user.isArchived()));
        });
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(UUID.class), any(UUID.class))).thenAnswer(invocation -> {
            UUID targetId = invocation.getArgument(2); UUID teacherId = invocation.getArgument(3);
            if (invocation.<String>getArgument(0).contains("student_groups"))
                return groups.findById(targetId).filter(group -> group.getTeacher().getId().equals(teacherId)).isPresent() ? 1 : 0;
            return users.findById(targetId).filter(user -> user.getRole() == Role.STUDENT && !user.isArchived() && user.getTeacher() != null
                    && user.getTeacher().getId().equals(teacherId)).isPresent() ? 1 : 0;
        });
        when(jdbc.queryForObject(contains("FROM lesson_history"), eq(Integer.class), any(UUID.class), anyString()))
                .thenAnswer(invocation -> owned(invocation.getArgument(2), invocation.getArgument(3),
                        invocation.<String>getArgument(0).contains("deleted_at IS NULL")).isPresent() ? 1 : 0);
        when(history.save(any())).thenAnswer(invocation -> {
            LessonHistoryEntry entry = invocation.getArgument(0);
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            writtenPrincipal = authentication == null ? null : authentication.getPrincipal();
            writtenAudit = authentication == null ? null : authentication.getDetails();
            entries.put(entry.getEventId(), entry);
            return entry;
        });
        when(history.findByTeacherIdAndEventId(any(), anyString())).thenAnswer(invocation -> owned(invocation.getArgument(0), invocation.getArgument(1), false));
        when(history.findLockedByTeacherIdAndEventId(any(), anyString())).thenAnswer(invocation -> owned(invocation.getArgument(0), invocation.getArgument(1), true));
        when(receipts.execute(any(), any(), anyString(), anyString(), anyMap(), any(), any())).thenAnswer(invocation -> {
            invocation.<Runnable>getArgument(5).run();
            invocation.<Runnable>getArgument(5).run();
            return invocation.<Supplier<Object>>getArgument(6).get();
        });
    }

    private Optional<LessonHistoryEntry> owned(UUID teacherId, String eventId, boolean activeOnly) {
        return Optional.ofNullable(entries.get(eventId)).filter(entry -> entry.getTeacher().getId().equals(teacherId))
                .filter(entry -> !activeOnly || entry.getDeletedAt() == null);
    }
    private Map<String, Object> create() {
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("title", "Fractions"); args.put("date", "2026-11-05"); args.put("startTime", "16:30");
        args.put("durationMinutes", 60); args.put("targetType", "trial"); args.put("idempotencyKey", "requested-lesson");
        return args;
    }
    private LessonHistoryEntry existing(String eventId, String bindingKey) {
        GroupLessonResponse lesson = new GroupLessonResponse(eventId, bindingKey, null, null, null, null,
                List.of(), "Existing lesson", Instant.parse("2026-11-05T15:30:00Z"), Instant.parse("2026-11-05T16:30:00Z"), null, null);
        LessonHistoryEntry entry = LessonHistoryEntry.create(teacher, lesson);
        entries.put(eventId, entry);
        return entry;
    }
    @SuppressWarnings("unchecked") private Map<String, Object> call(String tool, Map<String, Object> args, User actor) {
        return (Map<String, Object>) service.call(tool, args, actor, false);
    }

    @Test
    void exposesFiveTypedSchedulingToolsInsteadOfPdfGenerationAliases() {
        assertThat(McpLessonScheduleService.definitions()).extracting(tool -> tool.get("name"))
                .containsExactly("create_lesson", "create_lesson_series", "update_lesson", "delete_lesson", "assign_lesson");
        for (Map<String, Object> tool : McpLessonScheduleService.definitions()) {
            Map<?, ?> schema = (Map<?, ?>) tool.get("inputSchema");
            assertThat(schema.get("additionalProperties")).isEqualTo(false);
            assertThat(((List<?>) schema.get("required")).contains("idempotencyKey")).isTrue();
        }
        assertThat(McpLessonScheduleService.handles("create_lesson_draft")).isFalse();
    }

    @ParameterizedTest
    @CsvSource({"2026-11-05,2026-11-05T15:30:00Z", "2026-07-05,2026-07-05T14:30:00Z"})
    void regularTeacherCreatesNativeLessonAtExactBerlinTimeWithoutGoogle(String date, String expected) {
        Map<String, Object> args = create(); args.put("date", date); args.put("targetType", "student"); args.put("targetId", student.getId().toString());
        Map<String, Object> result = call("create_lesson", args, teacher);
        LessonHistoryEntry saved = entries.get(result.get("eventId"));
        assertThat(saved.getStartsAt()).isEqualTo(Instant.parse(expected));
        assertThat(saved.getEndsAt()).isEqualTo(Instant.parse(expected).plusSeconds(3600));
        assertThat(saved.getStudentId()).isEqualTo(student.getId());
        assertThat(saved.getTeacher().getId()).isEqualTo(teacher.getId());
        assertThat(result).containsEntry("googleCalendarChanged", false);
        verifyNoInteractions(calendar);
    }

    @Test
    void administratorInfersOwnedGroupTeacherAndDelegatesWithOriginalActorInAudit() {
        StudentGroup group = StudentGroup.create(teacher, "Group A");
        when(groups.findById(group.getId())).thenReturn(Optional.of(group));
        when(groups.findByIdAndTeacherId(group.getId(), teacher.getId())).thenReturn(Optional.of(group));
        Map<String, Object> args = create(); args.put("targetType", "group"); args.put("targetId", group.getId().toString());
        var previous = SecurityContextHolder.getContext();
        call("create_lesson", args, admin);
        assertThat(SecurityContextHolder.getContext()).isSameAs(previous);
        assertThat(writtenPrincipal).isEqualTo(new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.TEACHER));
        assertThat(writtenAudit).isEqualTo(new McpAccessService.DelegationAudit(admin.getId(), Role.ADMIN, teacher.getId()));
        assertThat(entries.values()).singleElement().satisfies(entry -> {
            assertThat(entry.getTeacher().getId()).isEqualTo(teacher.getId());
            assertThat(entry.getGroupId()).isEqualTo(group.getId());
        });
        verify(receipts).execute(argThat(actor -> actor.id().equals(admin.getId())), eq(teacher.getId()), eq("create_lesson"), eq("requested-lesson"), anyMap(), any(), any());
    }

    @Test
    void rejectsKeyOnlyStudentArchivedAndForeignTeacherBeforeAnyReceiptOrScheduleWrite() {
        assertThatThrownBy(() -> service.call("create_lesson", create(), null, true)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.call("create_lesson", create(), null, false)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> call("create_lesson", create(), student)).isInstanceOf(ResponseStatusException.class);
        Map<String, Object> foreignTeacher = create(); foreignTeacher.put("teacherId", other.getId().toString());
        assertThatThrownBy(() -> call("create_lesson", foreignTeacher, teacher)).isInstanceOf(ResponseStatusException.class);
        teacher.archive();
        assertThatThrownBy(() -> call("create_lesson", create(), teacher)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(receipts); verify(history, never()).save(any());
    }

    @Test
    void rejectsForeignPupilAndAdminTrialWithoutAnExplicitTeacher() {
        User foreign = User.managedStudent("Foreign", other); when(users.findById(foreign.getId())).thenReturn(Optional.of(foreign));
        Map<String, Object> args = create(); args.put("targetType", "student"); args.put("targetId", foreign.getId().toString());
        assertThatThrownBy(() -> call("create_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("selected teacher");
        assertThatThrownBy(() -> call("create_lesson", create(), admin)).isInstanceOf(ResponseStatusException.class).hasMessageContaining("teacherId");
        verifyNoInteractions(receipts); verify(history, never()).save(any());
    }

    @Test
    void rechecksFreshDatabaseOwnershipAfterAReceiptWaitEvenWhenJpaStillHasTheOldTeacher() {
        Map<String, Object> args = create(); args.put("targetType", "student"); args.put("targetId", student.getId().toString());
        when(jdbc.queryForObject(contains("FROM users WHERE id"), eq(Integer.class), eq(student.getId()), eq(teacher.getId())))
                .thenReturn(1, 1, 0);
        assertThatThrownBy(() -> call("create_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("selected teacher");
        assertThat(student.getTeacher().getId()).isEqualTo(teacher.getId());
        verify(history, never()).save(any());
    }

    @ParameterizedTest
    @CsvSource({"2026-03-29,02:30", "2026-10-25,02:30"})
    void rejectsNonexistentOrRepeatedBerlinSingleLessonTime(String date, String time) {
        Map<String, Object> args = create(); args.put("date", date); args.put("startTime", time);
        assertThatThrownBy(() -> call("create_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("ambiguous Berlin");
        verify(history, never()).save(any());
    }

    @Test
    void validatesIntegerDurationTargetExclusivityAndUnknownFields() {
        for (Number value : List.of(0, 1441, 1.5)) {
            Map<String, Object> args = create(); args.put("durationMinutes", value);
            assertThatThrownBy(() -> call("create_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("durationMinutes");
        }
        Map<String, Object> trialWithTarget = create(); trialWithTarget.put("targetId", student.getId().toString());
        assertThatThrownBy(() -> call("create_lesson", trialWithTarget, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Trial");
        Map<String, Object> typo = create(); typo.put("startsAt", "2026-11-05T16:30Z");
        assertThatThrownBy(() -> call("create_lesson", typo, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Unsupported");
        verify(history, never()).save(any());
    }

    @Test
    void finiteSeriesUsesExistingAtomicServiceAndKeepsLocalClockAcrossDst() {
        Map<String, Object> args = create(); args.remove("date"); args.put("startDate", "2026-10-24");
        args.put("period", "TWO_WEEKS"); args.put("weekdays", List.of(6));
        Map<String, Object> result = call("create_lesson_series", args, teacher);
        assertThat(result.get("count")).isEqualTo(2);
        assertThat(entries.values()).extracting(LessonHistoryEntry::getStartsAt)
                .containsExactly(Instant.parse("2026-10-24T14:30:00Z"), Instant.parse("2026-10-31T15:30:00Z"));
        assertThat(entries.values()).extracting(LessonHistoryEntry::getEventId).doesNotHaveDuplicates();
    }

    @Test
    void reschedulingPreservesEventIdentityAndDoesNotTouchGoogle() {
        LessonHistoryEntry entry = existing("google-instance", "google-series");
        Map<String, Object> args = new LinkedHashMap<>(Map.of("eventId", entry.getEventId(), "date", "2026-11-08", "startTime", "10:15", "durationMinutes", 90, "idempotencyKey", "move-one"));
        Map<String, Object> result = call("update_lesson", args, teacher);
        assertThat(result.get("eventId")).isEqualTo("google-instance");
        assertThat(entry.getStartsAt()).isEqualTo(Instant.parse("2026-11-08T09:15:00Z"));
        assertThat(entry.getEndsAt()).isEqualTo(Instant.parse("2026-11-08T10:45:00Z"));
        assertThat(entry.isScheduleManuallyEdited()).isTrue();
        verifyNoInteractions(calendar);
    }

    @Test
    void receiptRetryRechecksCurrentLessonTombstoneInsteadOfThePreviouslyLoadedEntity() {
        LessonHistoryEntry entry = existing("local-deleted-concurrently", "local-deleted-concurrently");
        when(jdbc.queryForObject(contains("FROM lesson_history"), eq(Integer.class), eq(teacher.getId()), eq(entry.getEventId())))
                .thenReturn(1, 0);
        Map<String, Object> args = Map.of("eventId", entry.getEventId(), "date", "2026-11-08", "startTime", "10:15", "durationMinutes", 90, "idempotencyKey", "move-one");
        assertThatThrownBy(() -> call("update_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("not found");
        assertThat(entry.getDeletedAt()).isNull();
        assertThat(entry.getStartsAt()).isEqualTo(Instant.parse("2026-11-05T15:30:00Z"));
        verify(history, never()).save(any());
    }

    @Test
    void assignmentKeepsNativeBindingScopedAndRequiresExplicitWholeSeriesIntentForImportedLessons() {
        LessonHistoryEntry nativeLesson = existing("local-one", "local-one");
        Map<String, Object> args = new LinkedHashMap<>(Map.of("eventId", nativeLesson.getEventId(), "targetType", "student", "targetId", student.getId().toString(), "idempotencyKey", "assign-one"));
        assertThat(call("assign_lesson", args, teacher)).containsEntry("assignmentSaved", true).containsEntry("appliesToSeries", false);
        assertThat(nativeLesson.getStudentId()).isEqualTo(student.getId());
        existing("google-instance", "google-series"); args.put("eventId", "google-instance");
        assertThatThrownBy(() -> call("assign_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("applyToSeries");
        verifyNoInteractions(calendar);
        args.put("applyToSeries", true); args.put("idempotencyKey", "assign-series");
        assertThat(call("assign_lesson", args, teacher)).containsEntry("bindingKey", "google-series").containsEntry("appliesToSeries", true);
        verify(calendar).bindStudent(any(AuthenticatedUser.class), eq("google-series"), eq(student.getId()));
    }

    @Test
    void explicitDeleteTombstonesOneOwnedLessonAndClosesItsRoomsWithoutRemovingHistory() {
        LessonHistoryEntry entry = existing("local-delete", "local-delete");
        OnlineClass room = OnlineClass.forStudent(teacher, entry.getEventId(), entry.getEventId(), entry.getTitle(),
                entry.getStartsAt(), entry.getEndsAt(), student);
        when(rooms.findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(teacher.getId(), entry.getEventId())).thenReturn(List.of(room));
        Map<String, Object> args = new LinkedHashMap<>(Map.of("eventId", entry.getEventId(), "idempotencyKey", "delete-one"));
        assertThatThrownBy(() -> call("delete_lesson", args, teacher)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("confirm=true");
        args.put("confirm", true);
        assertThat(call("delete_lesson", args, teacher)).containsEntry("materialsPreserved", true).containsEntry("removedFromSchedule", true);
        assertThat(entry.getDeletedAt()).isNotNull();
        assertThat(entries).containsKey(entry.getEventId());
        verify(classroom).closeForLessonRemoval(any(AuthenticatedUser.class), eq(room.getId()));
        verify(history, never()).delete(any());
    }
}
