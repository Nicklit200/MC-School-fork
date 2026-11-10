package com.mcschool.flashcard.liveclasses;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.mcschool.flashcard.users.Role;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** A bounded, current-room snapshot. Called only after Kolyn has checked the owning teacher. */
@Service
public class KolinTranscriptContextService {
    /** The last 100 finalized utterances, newest-first at query time, then chronological for the model. */
    static final int MAX_SEGMENTS = 100;
    static final int MAX_SERIALIZED_CHARS = 120000;
    private final OnlineClassTranscriptSegmentRepository segments;
    private final ObjectMapper mapper;

    public KolinTranscriptContextService(OnlineClassTranscriptSegmentRepository segments, ObjectMapper mapper) {
        this.segments = segments;
        this.mapper = mapper;
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Metadata(String state, int segmentCount, boolean truncated, String latestSegmentAt,
                           Long fromMs, Long toMs, boolean transcriptionActive) {}
    public record Turn(String speakerName, String speakerRole, long startMs, long endMs, String text) {}
    public record Context(Metadata metadata, List<Turn> segments) {}

    /** The read transaction ends before any OpenAI request starts. No archive or PDF is read. */
    @Transactional(readOnly = true)
    public Context read(OnlineClass room) {
        var recent = segments.findByOnlineClassIdOrderByStartMsDescIdDesc(
                room.getId(), PageRequest.of(0, MAX_SEGMENTS + 1));
        boolean truncated = recent.size() > MAX_SEGMENTS;
        boolean active = room.getTranscriptionState() == ClassFeatureState.ACTIVE;
        boolean budgetExceeded = false;
        var kept = new ArrayList<OnlineClassTranscriptSegment>();
        for (int i = 0; i < Math.min(MAX_SEGMENTS, recent.size()); i++) {
            var segment = recent.get(i);
            if (!room.getId().equals(segment.getOnlineClass().getId()))
                throw new IllegalStateException("Transcript room mismatch");
            if (segment.getText() == null || segment.getText().isBlank()) continue;
            kept.add(segment);
            if (mapper.writeValueAsString(context(kept, truncated, active)).length() > MAX_SERIALIZED_CHARS) {
                kept.remove(kept.size() - 1);
                truncated = true;
                budgetExceeded = true;
                // A contiguous suffix of whole utterances is more useful than filling gaps with older speech.
                break;
            }
        }
        if (budgetExceeded && kept.isEmpty())
            return new Context(new Metadata("unavailable", 0, true, null, null, null, active), List.of());
        return context(kept, truncated, active);
    }

    public static Context unavailable(OnlineClass room) {
        return new Context(new Metadata("unavailable", 0, false, null, null, null,
                room.getTranscriptionState() == ClassFeatureState.ACTIVE), List.of());
    }

    private static Context context(List<OnlineClassTranscriptSegment> newestFirst, boolean truncated, boolean active) {
        var turns = new ArrayList<Turn>();
        Instant latest = null;
        Long from = null, to = null;
        for (var segment : newestFirst) {
            var speaker = segment.getUser();
            String name = speaker == null ? "Участник" : speaker.getFullName();
            if (name == null || name.isBlank()) name = "Участник";
            String role = speaker != null && speaker.getRole() == Role.TEACHER ? "teacher"
                    : speaker != null && speaker.getRole() == Role.STUDENT ? "student" : "unknown";
            turns.add(new Turn(name.strip(), role, segment.getStartMs(), segment.getEndMs(), segment.getText()));
            if (segment.getCreatedAt() != null && (latest == null || segment.getCreatedAt().isAfter(latest)))
                latest = segment.getCreatedAt();
            from = from == null ? segment.getStartMs() : Math.min(from, segment.getStartMs());
            to = to == null ? segment.getEndMs() : Math.max(to, segment.getEndMs());
        }
        Collections.reverse(turns);
        return new Context(new Metadata(turns.isEmpty() ? "empty" : "included", turns.size(), truncated,
                latest == null ? null : latest.toString(), from, to, active), List.copyOf(turns));
    }
}
