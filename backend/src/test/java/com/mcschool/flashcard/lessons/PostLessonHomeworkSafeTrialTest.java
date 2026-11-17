package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.homeworks.HomeworkPdfService;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.liveclasses.*;
import com.mcschool.flashcard.monthlyplans.MonthlyPlanService;
import com.mcschool.flashcard.notifications.PostLessonHomeworkPushService;
import com.mcschool.flashcard.settings.SchoolPromptSettingsService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** No database connection or network call. All user IDs in this fixture are fictional. */
class PostLessonHomeworkSafeTrialTest {
    private static final String TEST_EVENT = "sandbox-20261117-1020-brueche-terme";
    private static final String TEST_NAME = "Mindcrafti Testschueler";
    private final UUID teacherId = UUID.fromString("00000000-0000-4000-a000-000000000020");
    private final UUID studentId = UUID.fromString("00000000-0000-4000-a000-000000000021");
    private final UUID roomId = UUID.fromString("00000000-0000-4000-a000-000000001020");
    private final UUID jobId = UUID.fromString("00000000-0000-4000-a000-000000001030");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final HomeworkRepository homeworks = mock(HomeworkRepository.class);
    private final HomeworkPdfService publisher = mock(HomeworkPdfService.class);
    private final LessonPreparationRepository preparations = mock(LessonPreparationRepository.class);
    private final LessonPreparationService lessonPreparation = mock(LessonPreparationService.class);
    private final OnlineClassTranscriptSegmentRepository transcripts = mock(OnlineClassTranscriptSegmentRepository.class);
    private final MonthlyPlanService plans = mock(MonthlyPlanService.class);
    private final SchoolPromptSettingsService prompts = mock(SchoolPromptSettingsService.class);
    private final PostLessonHomeworkContentService generator = mock(PostLessonHomeworkContentService.class);
    private final PostLessonHomeworkPushService push = mock(PostLessonHomeworkPushService.class);
    private final PostLessonHomeworkPilotAccess pilot = mock(PostLessonHomeworkPilotAccess.class);
    private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);

    private final AuthenticatedUser actor = new AuthenticatedUser(teacherId, null, Role.TEACHER);
    private final OnlineClass room = mock(OnlineClass.class);
    private final User student = mock(User.class);
    private PostLessonHomeworkJobService jobs;

    @BeforeEach void setup() {
        when(transactions.getTransaction(any())).thenAnswer(i -> new SimpleTransactionStatus());
        when(generator.configured()).thenReturn(true);
        when(access.requireHost(actor, roomId)).thenReturn(room);
        when(room.getEventId()).thenReturn(TEST_EVENT);
        when(room.getTitle()).thenReturn("17.11.2026 10:20 Testunterricht Brueche und Terme");
        when(room.getStudent()).thenReturn(student);
        when(student.getId()).thenReturn(studentId);
        when(student.getFullName()).thenReturn(TEST_NAME);
        when(student.getRole()).thenReturn(Role.STUDENT);
        when(student.getStatus()).thenReturn(UserStatus.ACTIVE);
        when(student.getTeacher()).thenReturn(mock(User.class));
        when(student.getTeacher().getId()).thenReturn(teacherId);
        jobs = new PostLessonHomeworkJobService(jdbc,transactions,new ObjectMapper(),access,
                members,users,homeworks,publisher,preparations,lessonPreparation,transcripts,plans,prompts,generator,push,pilot);
    }

    @Test void afterFinishOnlyFictionalPupilIsQueuedNotAssigned() {
        when(room.getStatus()).thenReturn(OnlineClassStatus.ENDED);
        when(jdbc.query(startsWith("SELECT * FROM post_lesson_homework_jobs WHERE class_id=? FOR UPDATE"),
                any(org.springframework.jdbc.core.RowMapper.class),eq(roomId)))
                .thenReturn(Collections.emptyList());
        String note = "Nur für Mindcrafti Testschueler. Kein echter Schüler darf die Hausaufgabe bekommen.";
        // Mimic only a successful DB job read-back: never write any actual pupil work.
        PostLessonHomeworkJobService.Job stored = new PostLessonHomeworkJobService.Job(
                jobId,roomId,teacherId,TEST_EVENT,3,LocalDate.of(2026,11,18),
                note,"[{\"id\":\""+studentId+"\",\"name\":\""+TEST_NAME+"\"}]",null,"QUEUED",0,0);
        when(jdbc.query(eq("SELECT * FROM post_lesson_homework_jobs WHERE id=?"),
                any(org.springframework.jdbc.core.RowMapper.class),any(UUID.class)))
                .thenReturn(List.of(stored));
        when(jdbc.query(eq("SELECT failure_code FROM post_lesson_homework_jobs WHERE id=?"),
                any(org.springframework.jdbc.core.RowMapper.class),any(UUID.class)))
                .thenReturn(Collections.singletonList(null));
        Map<String,Object> queued=jobs.enqueue(actor,roomId,
                new PostLessonHomeworkJobService.Request(3,note));
        assertEquals("QUEUED",queued.get("state"));
        assertEquals(3,queued.get("days"));
        assertEquals("2026-11-18",queued.get("startDate"));
        verify(jdbc).update(startsWith("INSERT INTO post_lesson_homework_jobs"),any(Object[].class));
        verifyNoInteractions(publisher);
        verifyNoInteractions(homeworks);
    }

    @Test void noHomeworkIsQueuedBeforeAnActualEnd() {
        when(room.getStatus()).thenReturn(OnlineClassStatus.LIVE);
        assertThrows(ResponseStatusException.class,()->
                jobs.enqueue(actor,roomId,new PostLessonHomeworkJobService.Request(3,"")));
        verifyNoInteractions(jdbc,publisher);
    }

    @Test void aTeacherOnlyClassDoesNotGenerateHomework() {
        when(room.getStatus()).thenReturn(OnlineClassStatus.ENDED);
        when(room.getStudent()).thenReturn(null);
        assertThrows(ResponseStatusException.class,()->
                jobs.enqueue(actor,roomId,new PostLessonHomeworkJobService.Request(3,"")));
        verifyNoInteractions(jdbc,publisher);
    }

    @Test void outsideDayLimitNeverTouchesStorage() {
        assertThrows(IllegalArgumentException.class,()->
                jobs.enqueue(actor,roomId,new PostLessonHomeworkJobService.Request(8,"")));
        verifyNoInteractions(jdbc,publisher);
    }
}
