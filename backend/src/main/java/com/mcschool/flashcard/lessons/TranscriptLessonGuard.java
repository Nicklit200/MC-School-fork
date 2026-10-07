package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

@Service
public class TranscriptLessonGuard {

    private static final ZoneId LESSON_TIMEZONE = ZoneId.of("Europe/Berlin");
    private static final Pattern SONIOX_STAMP = Pattern.compile(
            "(?<!\\d)(\\d{4}-\\d{2}-\\d{2})(?:[-_ .](\\d{2})[-_:.](\\d{2}))?(?!\\d)");

    private final LessonHistoryRepository historyRepository;
    private final LessonPreparationRepository preparationRepository;

    public TranscriptLessonGuard(
            LessonHistoryRepository historyRepository,
            LessonPreparationRepository preparationRepository) {
        this.historyRepository = historyRepository;
        this.preparationRepository = preparationRepository;
    }

    public void validate(AuthenticatedUser teacher, String eventId, String filename) {
        LessonHistoryEntry selected = historyRepository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseThrow(() -> new IllegalArgumentException("Lesson history was not found for transcript validation"));

        Assessment assessment = assess(teacher.id(), selected, filename);
        if (!"ok".equals(assessment.status())) {
            throw new IllegalArgumentException(assessment.message());
        }
    }

    public Map<String, Object> auditAll() {
        List<Map<String, Object>> wrongLinks = new ArrayList<>();
        List<Map<String, Object>> unverifiable = new ArrayList<>();
        int total = 0;
        int verified = 0;

        for (LessonPreparation preparation : preparationRepository.findAllWithTeacher()) {
            if (!preparation.hasTranscriptPdf()) continue;
            total++;

            UUID teacherId = preparation.getTeacher().getId();
            LessonHistoryEntry lesson = historyRepository
                    .findByTeacherIdAndEventId(teacherId, preparation.getEventId())
                    .orElse(null);

            if (lesson == null) {
                Map<String, Object> issue = issue(preparation, null, "missing_lesson_history",
                        "Transcript is attached to an event that is missing from lesson history", null);
                wrongLinks.add(issue);
                continue;
            }

            Assessment assessment = assess(teacherId, lesson, preparation.getTranscriptFilename());
            if ("ok".equals(assessment.status())) {
                verified++;
            } else if ("unverifiable_filename".equals(assessment.status())) {
                unverifiable.add(issue(preparation, lesson, assessment.status(), assessment.message(), assessment.nearestEventId()));
            } else {
                wrongLinks.add(issue(preparation, lesson, assessment.status(), assessment.message(), assessment.nearestEventId()));
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalTranscriptPdfs", total);
        result.put("verified", verified);
        result.put("wrongLinkCount", wrongLinks.size());
        result.put("unverifiableCount", unverifiable.size());
        result.put("wrongLinks", wrongLinks);
        result.put("unverifiable", unverifiable);
        result.put("rule", "New transcript uploads must contain a Soniox date. If the filename also contains time, the selected event must be the unique closest lesson for that teacher on that date.");
        return result;
    }

    private Assessment assess(UUID teacherId, LessonHistoryEntry selected, String filename) {
        TranscriptStamp stamp = parse(filename);
        if (stamp == null) {
            return new Assessment(
                    "unverifiable_filename",
                    "Transcript filename must contain the Soniox date in YYYY-MM-DD format",
                    null);
        }

        LocalDate selectedDate = selected.getStartsAt().atZone(LESSON_TIMEZONE).toLocalDate();
        if (!selectedDate.equals(stamp.date())) {
            return new Assessment(
                    "wrong_date",
                    "Transcript date " + stamp.date() + " does not match lesson date " + selectedDate,
                    null);
        }

        List<LessonHistoryEntry> sameDay = historyRepository.findAllByTeacherIdOrderByStartsAtAsc(teacherId).stream()
                .filter(item -> item.getStartsAt().atZone(LESSON_TIMEZONE).toLocalDate().equals(stamp.date()))
                .toList();

        if (sameDay.size() <= 1) return new Assessment("ok", "ok", selected.getEventId());

        if (stamp.time() == null) {
            return new Assessment(
                    "ambiguous_same_day",
                    "Several lessons exist on " + stamp.date() + "; the transcript filename must also contain Soniox time",
                    null);
        }

        LocalDateTime transcriptTime = LocalDateTime.of(stamp.date(), stamp.time());
        List<LessonDistance> ranked = sameDay.stream()
                .map(item -> new LessonDistance(item, distanceSeconds(transcriptTime, item)))
                .sorted(Comparator.comparingLong(LessonDistance::distanceSeconds))
                .toList();

        long bestDistance = ranked.get(0).distanceSeconds();
        List<LessonDistance> closest = ranked.stream()
                .filter(item -> item.distanceSeconds() == bestDistance)
                .toList();

        if (closest.size() != 1) {
            return new Assessment(
                    "ambiguous_time",
                    "Transcript time " + stamp.time() + " is equally close to several lessons; automatic attachment is blocked",
                    null);
        }

        LessonHistoryEntry nearest = closest.get(0).lesson();
        if (!nearest.getEventId().equals(selected.getEventId())) {
            return new Assessment(
                    "wrong_lesson_time",
                    "Transcript time " + stamp.time() + " belongs closest to lesson " + nearest.getTitle()
                            + " (" + nearest.getEventId() + "), not selected event " + selected.getEventId(),
                    nearest.getEventId());
        }

        return new Assessment("ok", "ok", selected.getEventId());
    }

    private long distanceSeconds(LocalDateTime timestamp, LessonHistoryEntry lesson) {
        LocalDateTime startsAt = lesson.getStartsAt().atZone(LESSON_TIMEZONE).toLocalDateTime();
        LocalDateTime endsAt = lesson.getEndsAt().atZone(LESSON_TIMEZONE).toLocalDateTime();
        if (timestamp.isBefore(startsAt)) return Math.abs(ChronoUnit.SECONDS.between(timestamp, startsAt));
        if (timestamp.isAfter(endsAt)) return Math.abs(ChronoUnit.SECONDS.between(endsAt, timestamp));
        return 0L;
    }

    private TranscriptStamp parse(String filename) {
        if (filename == null || filename.isBlank()) return null;
        Matcher matcher = SONIOX_STAMP.matcher(filename);
        if (!matcher.find()) return null;

        try {
            LocalDate date = LocalDate.parse(matcher.group(1));
            LocalTime time = matcher.group(2) == null || matcher.group(3) == null
                    ? null
                    : LocalTime.of(Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(3)));
            return new TranscriptStamp(date, time);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private Map<String, Object> issue(
            LessonPreparation preparation,
            LessonHistoryEntry lesson,
            String status,
            String message,
            String nearestEventId) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("teacherId", preparation.getTeacher().getId().toString());
        item.put("teacherName", preparation.getTeacher().getFullName());
        item.put("eventId", preparation.getEventId());
        item.put("lessonTitle", lesson == null ? null : lesson.getTitle());
        item.put("lessonStartsAt", lesson == null ? null : lesson.getStartsAt().toString());
        item.put("transcriptFilename", preparation.getTranscriptFilename());
        item.put("status", status);
        item.put("message", message);
        item.put("nearestEventId", nearestEventId);
        return item;
    }

    private record TranscriptStamp(LocalDate date, LocalTime time) {}
    private record Assessment(String status, String message, String nearestEventId) {}
    private record LessonDistance(LessonHistoryEntry lesson, long distanceSeconds) {}
}
