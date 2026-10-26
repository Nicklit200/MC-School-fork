package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.CreateLessonSeriesRequest;
import com.mcschool.flashcard.lessons.dto.CreateLessonSeriesRequest.Period;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.*;
import jakarta.validation.Validation;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class LessonSeriesServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final LessonHistoryRepository history = mock(LessonHistoryRepository.class);
    private final ManualLessonService service = new ManualLessonService(users, groups, mock(StudentGroupMemberRepository.class), history,
            mock(com.mcschool.flashcard.liveclasses.OnlineClassRepository.class),
            mock(com.mcschool.flashcard.liveclasses.OnlineClassService.class));
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "unused");
    private final AuthenticatedUser caller = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), Role.TEACHER);
    private final LocalDate thursday = LocalDate.of(2026, 10, 22);
    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");

    @BeforeEach
    void prepareTeacher() { when(users.findById(teacher.getId())).thenReturn(Optional.of(teacher)); }

    private CreateLessonSeriesRequest request(Period period, Set<Integer> weekdays) {
        return new CreateLessonSeriesRequest("Test lessons", thursday, 45, period, weekdays, null, null);
    }

    private List<LocalDate> dates(List<GroupLessonResponse> lessons) {
        return lessons.stream().map(lesson -> lesson.startsAt().atZone(SCHOOL_ZONE).toLocalDate()).toList();
    }

    @Test
    void twoWeeksCreatesExactlyTwoThursdaysAndUniqueDurableLessons() {
        var lessons = service.createSeries(caller, request(Period.TWO_WEEKS, Set.of(4)));
        assertThat(dates(lessons)).containsExactly(thursday, thursday.plusWeeks(1));
        assertThat(lessons).extracting(GroupLessonResponse::eventId).doesNotHaveDuplicates();
        assertThat(lessons).allSatisfy(lesson -> {
            assertThat(Duration.between(lesson.startsAt(), lesson.endsAt())).isEqualTo(Duration.ofMinutes(45));
            assertThat(lesson.meetUrl()).isNull();
        });
        verify(history, times(2)).save(any());
    }

    @Test
    void threeWeeksIncludesTheThirdOccurrenceButNotTheFourth() {
        assertThat(dates(service.createSeries(caller, request(Period.THREE_WEEKS, Set.of(4)))))
                .containsExactly(thursday, thursday.plusWeeks(1), thursday.plusWeeks(2));
    }

    @Test
    void rollingMonthCanContainFiveThursdays() {
        var lessons = service.createSeries(caller, request(Period.MONTH, Set.of(4)));
        assertThat(dates(lessons)).containsExactly(thursday, thursday.plusWeeks(1), thursday.plusWeeks(2), thursday.plusWeeks(3), thursday.plusWeeks(4));
    }

    @Test
    void supportsSeveralSelectedWeekdaysInChronologicalOrder() {
        assertThat(dates(service.createSeries(caller, request(Period.TWO_WEEKS, Set.of(1, 4)))))
                .containsExactly(thursday, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 29), LocalDate.of(2026, 11, 2));
    }

    @Test
    void monthEndClampsToTheNextMonthAndRespectsTheExclusiveBoundary() {
        var request = new CreateLessonSeriesRequest("Test", LocalDate.of(2027, 1, 31), 60, Period.MONTH, Set.of(7), null, null);
        assertThat(dates(service.createSeries(caller, request)))
                .containsExactly(LocalDate.of(2027, 1, 31), LocalDate.of(2027, 2, 7), LocalDate.of(2027, 2, 14), LocalDate.of(2027, 2, 21));
    }

    @Test
    void daylightSavingChangeKeepsEveryLessonOnItsLocalDateAndAtItsDuration() {
        var request = new CreateLessonSeriesRequest("Test", LocalDate.of(2026, 10, 25), 45, Period.TWO_WEEKS, Set.of(7), null, null);
        var lessons = service.createSeries(caller, request);
        assertThat(lessons.get(0).startsAt()).isEqualTo(Instant.parse("2026-10-24T22:00:00Z"));
        assertThat(lessons.get(1).startsAt()).isEqualTo(Instant.parse("2026-10-31T23:00:00Z"));
        assertThat(lessons).allSatisfy(lesson -> assertThat(Duration.between(lesson.startsAt(), lesson.endsAt())).isEqualTo(Duration.ofMinutes(45)));
    }

    @Test
    void selectedClockTimeStaysFixedAcrossWinterTimeChange() {
        var request = new CreateLessonSeriesRequest("Math", LocalDate.of(2026, 10, 24),
                60, Period.TWO_WEEKS, Set.of(6), null, null, LocalTime.of(16, 30));
        var lessons = service.createSeries(caller, request);
        assertThat(lessons).hasSize(2);
        assertThat(lessons.get(0).startsAt()).isEqualTo(Instant.parse("2026-10-24T14:30:00Z"));
        assertThat(lessons.get(1).startsAt()).isEqualTo(Instant.parse("2026-10-31T15:30:00Z"));
        assertThat(lessons).allSatisfy(item ->
                assertThat(item.startsAt().atZone(SCHOOL_ZONE).toLocalTime()).isEqualTo(LocalTime.of(16, 30)));
    }

    @Test
    void rejectsNonexistentOrRepeatedBerlinStartTime() {
        var missing = new CreateLessonSeriesRequest("Math", LocalDate.of(2026, 3, 29),
                60, Period.TWO_WEEKS, Set.of(7), null, null, LocalTime.of(2, 30));
        var repeated = new CreateLessonSeriesRequest("Math", LocalDate.of(2026, 10, 25),
                60, Period.TWO_WEEKS, Set.of(7), null, null, LocalTime.of(2, 30));
        assertThatThrownBy(() -> service.createSeries(caller, missing)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.createSeries(caller, repeated)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void rejectsEmptyOrInvalidWeekdaysAndInvalidDurationBeforeSaving() {
        for (Set<Integer> days : List.of(Set.<Integer>of(), Set.of(0), Set.of(8))) {
            assertThatThrownBy(() -> service.createSeries(caller, request(Period.MONTH, days))).isInstanceOf(ResponseStatusException.class);
        }
        var invalid = new CreateLessonSeriesRequest("Test", thursday, 0, Period.MONTH, Set.of(4), null, null);
        assertThatThrownBy(() -> service.createSeries(caller, invalid)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(history);
    }

    @Test
    void rejectsForeignTargetsBeforeAnyLessonIsSaved() {
        var foreign = new CreateLessonSeriesRequest("Test", thursday, 45, Period.MONTH, Set.of(4), UUID.randomUUID(), null);
        assertThatThrownBy(() -> service.createSeries(caller, foreign)).isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(history);
    }

    @Test
    void validatesTheHttpRequestShapeAndTargetExclusivity() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertThat(validator.validate(request(Period.MONTH, Set.of(4)))).isEmpty();
            assertThat(validator.validate(new CreateLessonSeriesRequest("Test", thursday, 45, Period.MONTH, Set.of(4), UUID.randomUUID(), UUID.randomUUID()))).hasSize(1);
            assertThat(validator.validate(new CreateLessonSeriesRequest("", null, null, null, Set.of(), null, null))).hasSize(5);
        }
    }
}
