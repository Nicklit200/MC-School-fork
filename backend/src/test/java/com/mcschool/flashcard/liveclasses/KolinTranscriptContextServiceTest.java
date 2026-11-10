package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

class KolinTranscriptContextServiceTest {
    private final OnlineClassTranscriptSegmentRepository rows = mock(OnlineClassTranscriptSegmentRepository.class);
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final KolinTranscriptContextService contexts = new KolinTranscriptContextService(rows, mapper);
    private final User teacher = User.activeTeacher("Учитель", "teacher@test.local", "teacher", "hash");
    private final User pupil = User.managedStudent("Виталина", teacher);
    private final Instant now = Instant.parse("2026-11-07T14:00:00Z");
    private final OnlineClass room = OnlineClass.forTeacherOnly(teacher, "current", "current", "Fractions", now, now.plusSeconds(3600));

    @BeforeEach void defaults() {
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(any(), any())).thenReturn(List.of());
    }

    private OnlineClassTranscriptSegment segment(long start, long end, User speaker, String label, String text, Instant created) {
        var row = OnlineClassTranscriptSegment.finalSegment(room, "provider-" + UUID.randomUUID(),
                ParticipantIdentity.of(speaker == null ? UUID.randomUUID() : speaker.getId(), "private-device"),
                speaker, label, "ru", start, end, text, 0.9);
        ReflectionTestUtils.setField(row, "createdAt", created);
        return row;
    }

    @Test void queriesOnlyCurrentRoomWithBoundedPageAndPreservesSpeakerRolesOrderAndOverlappingRange() throws Exception {
        room.setTranscriptionState(ClassFeatureState.ACTIVE);
        var latest = segment(2000, 3000, pupil, "untrusted label", "Ответ: 3/4", now);
        var earlierButLonger = segment(1000, 7000, teacher, "not the teacher name", "Сложим 1/2 и 1/4", now.plusSeconds(5));
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(latest, earlierButLonger));
        var result = contexts.read(room);
        var page = ArgumentCaptor.forClass(Pageable.class);
        verify(rows).findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), page.capture());
        assertThat(page.getValue().getPageSize()).isEqualTo(101);
        assertThat(page.getValue().getOffset()).isZero();
        assertThat(result.segments()).extracting(KolinTranscriptContextService.Turn::speakerName).containsExactly("Учитель", "Виталина");
        assertThat(result.segments()).extracting(KolinTranscriptContextService.Turn::speakerRole).containsExactly("teacher", "student");
        assertThat(result.metadata()).isEqualTo(new KolinTranscriptContextService.Metadata("included", 2, false,
                now.plusSeconds(5).toString(), 1000L, 7000L, true));
        String json = mapper.writeValueAsString(result);
        assertThat(json).doesNotContain(teacher.getId().toString(), pupil.getId().toString(), room.getId().toString(),
                "teacher@test.local", "provider-", "participantIdentity", "private-device", "untrusted label");
    }

    @Test void largeLessonFitsAndTheExtraRowMarksTruncationWithoutEnteringContext() {
        var descending = IntStream.range(0, 101).mapToObj(i -> segment(100-i, 101-i, teacher, null,
                "turn-" + (100-i), now)).toList();
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any()))
                .thenReturn(descending.subList(0, 100), descending);
        var exact = contexts.read(room);
        assertThat(exact.metadata().segmentCount()).isEqualTo(100);
        assertThat(exact.metadata().truncated()).isFalse();
        var more = contexts.read(room);
        assertThat(more.metadata().segmentCount()).isEqualTo(100);
        assertThat(more.metadata().truncated()).isTrue();
        assertThat(more.segments().get(0).text()).isEqualTo("turn-1");
        assertThat(more.segments().get(99).text()).isEqualTo("turn-100");
        assertThat(more.segments()).noneMatch(turn -> turn.text().equals("turn-0"));
    }

    @Test void tiedTimesKeepRepositoryIdOrderWhenReversedToChronologicalOrder() {
        var high = segment(1000, 1100, teacher, null, "higher id", now);
        var low = segment(1000, 1100, teacher, null, "lower id", now);
        ReflectionTestUtils.setField(high, "id", UUID.fromString("00000000-0000-0000-0000-000000000002"));
        ReflectionTestUtils.setField(low, "id", UUID.fromString("00000000-0000-0000-0000-000000000001"));
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(high, low));
        assertThat(contexts.read(room).segments()).extracting(KolinTranscriptContextService.Turn::text)
                .containsExactly("lower id", "higher id");
    }

    @Test void serializedEscapeExpansionCountsTowardBudgetAndKeepsWholeRecentUtterances() throws Exception {
        String escaped = "\"\\\n".repeat(8000);
        var a = segment(3000, 3100, teacher, null, "new-" + escaped, now);
        var b = segment(2000, 2100, pupil, null, "middle-" + escaped, now);
        var c = segment(1000, 1100, pupil, null, "old-" + escaped, now);
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(a, b, c));
        var result = contexts.read(room);
        assertThat(result.metadata().segmentCount()).isEqualTo(2);
        assertThat(result.metadata().truncated()).isTrue();
        assertThat(result.segments()).extracting(KolinTranscriptContextService.Turn::text)
                .containsExactly(b.getText(), a.getText());
        assertThat(mapper.writeValueAsString(result).length()).isLessThanOrEqualTo(120000);
    }

    @Test void overflowingMiddleUtteranceDoesNotBackfillOlderSpeech() {
        var recent = segment(3000, 3100, teacher, null, "Newest complete task", now);
        var huge = segment(2000, 2100, pupil, null, "\u0001".repeat(20000), now);
        var old = segment(1000, 1100, pupil, null, "Old task must not appear", now);
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(recent, huge, old));
        var result = contexts.read(room);
        assertThat(result.metadata().truncated()).isTrue();
        assertThat(result.segments()).extracting(KolinTranscriptContextService.Turn::text).containsExactly(recent.getText());
    }

    @Test void oversizedNewestUtteranceMeansUnavailableAndNeverAnEmptyLessonOrOlderBackfill() {
        var huge = segment(2000, 2100, teacher, null, "\u0001".repeat(20000), now);
        var old = segment(1000, 1100, pupil, null, "Older task", now);
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(huge, old));
        var result = contexts.read(room);
        assertThat(result.metadata()).isEqualTo(new KolinTranscriptContextService.Metadata("unavailable", 0, true, null, null, null, false));
        assertThat(result.segments()).isEmpty();
    }

    @Test void inactiveTranscriptionStillSuppliesStoredSpeechAndUnknownSpeakerUsesGenericName() {
        var row = segment(10, 20, null, "Общий микрофон", "1/4 плюс 1/4", null);
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(row));
        var result = contexts.read(room);
        assertThat(result.metadata().state()).isEqualTo("included");
        assertThat(result.metadata().transcriptionActive()).isFalse();
        assertThat(result.metadata().latestSegmentAt()).isNull();
        assertThat(result.segments().get(0).speakerName()).isEqualTo("Участник");
        assertThat(result.segments().get(0).speakerRole()).isEqualTo("unknown");
    }

    @Test void unknownSpeakerLabelsCannotLeakEmailOrDeviceIdentityIntoContext() throws Exception {
        String identity = ParticipantIdentity.of(UUID.randomUUID(), "private-device");
        for (String label : List.of("private@example.test", identity)) {
            var row = segment(10, 20, null, label, "The spoken task stays verbatim", now);
            when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(row));
            var result = contexts.read(room);
            assertThat(result.segments().get(0).speakerName()).isEqualTo("Участник");
            assertThat(result.segments().get(0).speakerRole()).isEqualTo("unknown");
            assertThat(result.segments().get(0).text()).isEqualTo(row.getText());
            assertThat(mapper.writeValueAsString(result)).doesNotContain(label, row.getParticipantIdentity());
        }
    }

    @Test void emptyTranscriptHasExplicitNullMetadataAndNoInventedActivityTimestamp() throws Exception {
        var result = contexts.read(room);
        assertThat(result.metadata()).isEqualTo(new KolinTranscriptContextService.Metadata("empty", 0, false, null, null, null, false));
        var json = mapper.readTree(mapper.writeValueAsString(result.metadata()));
        for (String field : List.of("latestSegmentAt", "fromMs", "toMs")) {
            assertThat(json.has(field)).isTrue();
            assertThat(json.path(field).isNull()).isTrue();
        }
        var blank = segment(10, 20, teacher, null, "  ", now);
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(blank));
        assertThat(contexts.read(room).metadata().state()).isEqualTo("empty");
    }

    @Test void refusesRowsFromAnotherRoomInsteadOfUsingTheirText() {
        var other = OnlineClass.forTeacherOnly(teacher, "old", "old", "Old room", now, now.plusSeconds(60));
        var row = segment(0, 1000, teacher, null, "Other-room private content", now);
        ReflectionTestUtils.setField(row, "onlineClass", other);
        when(rows.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()), any())).thenReturn(List.of(row));
        assertThatThrownBy(() -> contexts.read(room)).isInstanceOf(IllegalStateException.class)
                .hasMessage("Transcript room mismatch");
    }
}
