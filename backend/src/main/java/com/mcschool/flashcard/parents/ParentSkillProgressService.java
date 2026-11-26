package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.skills.SkillBoardService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * A read-only parent projection of the canonical school skill map and its
 * immutable history. No AI is invoked by a parent's page view. An unassessed
 * skill is null, NEVER an asserted 0% competence.
 */
@Service
public class ParentSkillProgressService {
    public record Skill(String id, String title, String germanTitle, String topicId,
                        Integer mastery, Instant updatedAt) {}
    public record Topic(String id, String title, int totalSkills, int assessedSkills,
                        Integer averagePercent, int confirmedPercent) {}
    public record TrendPoint(Instant at, int confirmedPercent, int assessedSkills,
                             String skillId, Integer previous, int current) {}
    /** One confirmed-progress milestone per real ended lesson, not per skill edit. */
    public record LessonSkillChange(String skillId, String skillTitle,
                                    Integer previous, int current, Instant changedAt,
                                    String sourceType, String explanation, String excerpt) {}
    public record LessonProgressPoint(UUID lessonId, String lessonTitle, Instant endedAt,
                                      Integer confirmedPercent, int assessedSkills,
                                      List<LessonSkillChange> changes) {}
    public record LessonEvidence(String skillId, String skillTitle, Integer previous,
                                 Integer current, String autonomy, String explanation,
                                 String excerpt, String origin, boolean changed) {}
    public record Lesson(UUID id, String title, Instant endedAt, String reviewState,
                         String summary, String summarySource, List<LessonEvidence> evidence) {}
    public record PracticeEvidence(String skillId, String skillTitle, String sourceType,
                                   String sourceRef, Instant at, UUID cycleLessonId,
                                   Integer previous, Integer current, boolean changed, String autonomy,
                                   String explanation, String excerpt) {}
    public record Dashboard(UUID studentId, String studentName, Integer grade,
                            String schoolType, String boardId, String boardTitle,
                            String curriculumSource, Integer confirmedPercent,
                            Integer assessedAveragePercent, int assessedSkills, int totalSkills,
                            Instant updatedAt, List<Topic> topics, List<Skill> skills,
                            List<TrendPoint> trend, List<Lesson> lessons,
                            List<PracticeEvidence> practice,
                            List<LessonProgressPoint> lessonProgress) {}

    private record Score(int value, Instant updatedAt) {}
    private record Change(String skillId, Integer previous, int current, Instant at) {}
    private record Proof(String skillId, String sourceType, String sourceRef, String autonomy,
                         String explanation, String excerpt, Integer after, Instant at) {}
    private record LessonRow(UUID id, String title, Instant at, String state,
                             String summary) {}

    private final UserRepository users;
    private final SkillBoardService boards;
    private final JdbcTemplate jdbc;

    public ParentSkillProgressService(UserRepository users, SkillBoardService boards, JdbcTemplate jdbc) {
        this.users = users;
        this.boards = boards;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public Dashboard get(AuthenticatedUser parent, UUID studentId) {
        User child = requireOwnChild(parent, studentId);
        Integer grade = child.getGrade();
        List<SkillBoardService.BoardSummary> candidates = grade == null ? List.of() :
                boards.list().stream().filter(board -> board.grade() == grade).toList();
        if (candidates.size() != 1)
            return new Dashboard(studentId, child.getFullName(), grade, child.getSchoolType(),
                    null, null, null, null, null, 0, 0,
                    null, List.of(), List.of(), List.of(), List.of(), List.of(), List.of());

        var board = boards.get(candidates.get(0).id());
        List<SkillBoardService.Node> applicable = relevantSkills(board.data(), child.getSchoolType());
        Set<String> allowed = new HashSet<>();
        for (var node : applicable) allowed.add(node.id());

        Map<String, Score> scores = new HashMap<>();
        jdbc.query("""
            SELECT skill_id, mastery, updated_at FROM student_skill_mastery
            WHERE student_id = ? AND board_id = ?
            """, (ResultSet rs) -> {
                scores.put(rs.getString("skill_id"), new Score(rs.getInt("mastery"),
                        rs.getTimestamp("updated_at").toInstant()));
            }, studentId, board.id());

        Map<String,String> topicBySkill = new HashMap<>();
        Map<String,SkillBoardService.Node> topicNodes = new LinkedHashMap<>();
        for (var node : board.data().nodes())
            if ("topic".equals(node.kind()) && !node.archived())
                topicNodes.put(node.id(), node);
        for (var edge : board.data().edges())
            if ("contains".equals(edge.kind()) && topicNodes.containsKey(edge.source()))
                topicBySkill.put(edge.target(), edge.source());

        List<Skill> skills = new ArrayList<>();
        for (var node : applicable) {
            Score score = scores.get(node.id());
            skills.add(new Skill(node.id(), node.title(), node.de(),
                    topicBySkill.get(node.id()), score == null ? null : score.value(),
                    score == null ? null : score.updatedAt()));
        }

        List<Topic> topics = new ArrayList<>();
        for (var topic : topicNodes.values()) {
            List<Skill> items = skills.stream().filter(s -> topic.id().equals(s.topicId())).toList();
            if (items.isEmpty()) continue;
            long evaluated = items.stream().filter(s -> s.mastery() != null).count();
            int sum = items.stream().filter(s -> s.mastery() != null)
                    .mapToInt(s -> s.mastery()).sum();
            topics.add(new Topic(topic.id(), topic.title(), items.size(), (int)evaluated,
                    evaluated == 0 ? null : (int)Math.round((double)sum / evaluated),
                    (int)Math.round((double)sum / items.size())));
        }

        int assessed = (int)skills.stream().filter(s -> s.mastery() != null).count();
        int total = skills.size();
        int currentSum = skills.stream().filter(s -> s.mastery() != null)
                .mapToInt(s -> s.mastery()).sum();
        Integer confirmed = assessed == 0 || total == 0 ? null :
                (int)Math.round((double)currentSum / total);
        Integer average = assessed == 0 ? null : (int)Math.round((double)currentSum / assessed);

        List<Change> history = jdbc.query("""
            SELECT skill_id, previous_mastery, mastery, updated_at FROM (
                SELECT id, skill_id, previous_mastery, mastery, updated_at
                FROM student_skill_mastery_history
                WHERE student_id=? AND board_id=?
                ORDER BY updated_at DESC, id DESC LIMIT 500
            ) recent ORDER BY updated_at, id
            """, (rs, i) -> new Change(rs.getString("skill_id"),
                    rs.getObject("previous_mastery", Integer.class), rs.getInt("mastery"),
                    rs.getTimestamp("updated_at").toInstant()), studentId, board.id());
        Map<String,Integer> historyState = new HashMap<>();
        List<TrendPoint> trend = new ArrayList<>();
        for (var change : history) {
            if (!allowed.contains(change.skillId())) continue;
            historyState.put(change.skillId(), change.current());
            trend.add(new TrendPoint(change.at(),
                    confirmedPercent(historyState, allowed), historyState.size(),
                    change.skillId(), change.previous(), change.current()));
        }

        List<Proof> proofRows = jdbc.query("""
            SELECT skill_id, source_type, source_ref, autonomy, explanation, source_excerpt,
                   mastery_after, recorded_at
            FROM student_skill_evidence
            WHERE student_id=? AND board_id=?
            ORDER BY recorded_at DESC LIMIT 500
            """, (rs, i) -> new Proof(rs.getString("skill_id"), rs.getString("source_type"),
                    rs.getString("source_ref"), rs.getString("autonomy"), rs.getString("explanation"),
                    rs.getString("source_excerpt"),
                    rs.getObject("mastery_after")==null?null:rs.getInt("mastery_after"),
                    rs.getTimestamp("recorded_at").toInstant()), studentId, board.id());
        Map<String,String> names = new HashMap<>();
        for (var item : skills) names.put(item.id(), item.title());

        // A room must be ended and this child must actually be in its own
        // participant/individual record OR in the immutable post-lesson roster.
        // Current group membership is NOT evidence of an old lesson's attendance.
        List<LessonRow> sessions = jdbc.query("""
            SELECT c.id,c.title,coalesce(c.actual_end_at,c.scheduled_end_at) AS ended_at,
                   coalesce(r.state,j.state,'NONE') AS review_state,
                   r.lesson_summary
            FROM online_classes c
            LEFT JOIN post_lesson_skill_review_jobs j ON j.class_id=c.id
            LEFT JOIN post_lesson_skill_review_students r
                ON r.class_id=c.id AND r.student_id=?
            WHERE c.status='ENDED'
              AND (c.student_id=?
                OR EXISTS (SELECT 1 FROM online_class_participants p
                    WHERE p.class_id=c.id AND p.user_id=? AND p.class_role='STUDENT'
                      AND (p.first_joined_at IS NOT NULL OR p.admission_state='ADMITTED'))
                OR EXISTS (SELECT 1 FROM post_lesson_skill_review_jobs owned
                    WHERE owned.class_id=c.id
                      AND owned.roster_json @> jsonb_build_array(CAST(? AS text))))
            ORDER BY ended_at DESC, c.id DESC LIMIT 35
            """, (rs, i) -> new LessonRow(rs.getObject("id",UUID.class),
                    rs.getString("title"), rs.getTimestamp("ended_at").toInstant(),
                    rs.getString("review_state"), rs.getString("lesson_summary")),
                    studentId, studentId, studentId, studentId.toString());

        List<Lesson> lessons = new ArrayList<>();
        for (var session : sessions) {
            String prefix = session.id().toString() + ":";
            List<LessonEvidence> items = new ArrayList<>();
            for (var proof : proofRows) {
                if (!"LESSON".equals(proof.sourceType()) || !proof.sourceRef().startsWith(prefix)
                        || !allowed.contains(proof.skillId())) continue;
                // A stored observation may not change mastery at all. Never
                // describe such an observation as an increase.
                Change matched = proof.after() == null ? null : history.stream()
                        .filter(h -> h.skillId().equals(proof.skillId())
                                && h.current() == proof.after()
                                && Math.abs(Duration.between(h.at(), proof.at()).toSeconds()) <= 120)
                        .min(Comparator.comparingLong(h ->
                                Math.abs(Duration.between(h.at(), proof.at()).toSeconds())))
                        .orElse(null);
                boolean changed = matched != null;
                String origin = proof.sourceRef().contains(":student-speech")
                        ? "STUDENT_SPEECH" : "WRITING";
                items.add(new LessonEvidence(proof.skillId(),
                        names.getOrDefault(proof.skillId(), proof.skillId()),
                        changed ? matched.previous() : null,
                        proof.after(), proof.autonomy(), proof.explanation(),
                        proof.excerpt(), origin, changed));
            }
            String summary = normalizedSummary(session.summary());
            String origin = summary == null ? "NONE" : "AI";
            if (summary == null && !items.isEmpty()) {
                String joined = items.stream().map(LessonEvidence::skillTitle).distinct()
                        .limit(5).reduce((a,b) -> a + ", " + b).orElse("");
                summary = joined.isBlank() ? null : joined;
                origin = "OBSERVED_SKILLS";
            }
            lessons.add(new Lesson(session.id(), session.title(), session.at(),
                    session.state(), summary, origin, List.copyOf(items)));
        }
        // Homework/test observations use the same mastery history as lessons.
        // The source is a verified database observation, NOT a guessed match
        // from a PDF upload. Direct score edits with no evidence remain unlabelled.
        // A homework result belongs only to the lesson cycle in which it
        // was ASSIGNED, never to every later lesson. A cycle starts after the
        // previous ended lesson and closes at the next ended lesson (or now).
        // We use homeworks.created_at, not a mutable due/start_date.
        List<LessonRow> chronologicalLessons = sessions.stream()
                .sorted(Comparator.comparing(LessonRow::at)).toList();
        List<Instant> lessonEnds = chronologicalLessons.stream().map(LessonRow::at).toList();
        List<Map.Entry<UUID,Instant>> assignedHomeworks = jdbc.query("""
                SELECT id,created_at FROM homeworks WHERE student_id=?
                ORDER BY created_at DESC LIMIT 500
                """, (rs,i) -> Map.entry(rs.getObject("id", UUID.class),
                        rs.getTimestamp("created_at").toInstant()),studentId);
        List<PracticeEvidence> practice = new ArrayList<>();
        for (var proof : proofRows) {
            if ("LESSON".equals(proof.sourceType()) || !allowed.contains(proof.skillId())) continue;
            UUID cycleLessonId = null;
            if ("HOMEWORK".equals(proof.sourceType())) {
                // The homework identity is explicit; do not infer its owner from
                // similarity of topics or the PDF's display filename.
                var ownedHomework = assignedHomeworks.stream()
                        .filter(hw -> proof.sourceRef().contains(hw.getKey().toString()))
                        .findFirst().orElse(null);
                if (ownedHomework == null || proof.at().isBefore(ownedHomework.getValue())) continue;
                Instant previousEnd = homeworkCycleStart(ownedHomework.getValue(), lessonEnds);
                if (previousEnd == null) continue;
                // Associate only with the first lesson ending AFTER assignment,
                // not every subsequent lesson. An in-progress cycle remains
                // unattached until that next lesson ends.
                var nextLesson = chronologicalLessons.stream()
                        .filter(session -> session.at().isAfter(ownedHomework.getValue()))
                        .findFirst().orElse(null);
                if (nextLesson != null) {
                    if (proof.at().isAfter(nextLesson.at())) continue;
                    cycleLessonId = nextLesson.id();
                } else {
                    // Do not backdate an open homework cycle to a previous lesson.
                    continue;
                }
            }
            Change matched = proof.after() == null ? null : history.stream()
                    .filter(h -> h.skillId().equals(proof.skillId())
                            && h.current() == proof.after()
                            && Math.abs(Duration.between(h.at(), proof.at()).toSeconds()) <= 120)
                    .min(Comparator.comparingLong(h ->
                            Math.abs(Duration.between(h.at(), proof.at()).toSeconds())))
                    .orElse(null);
            practice.add(new PracticeEvidence(proof.skillId(),
                    names.getOrDefault(proof.skillId(),proof.skillId()),
                    proof.sourceType(),proof.sourceRef(),proof.at(),cycleLessonId,
                    matched == null ? null : matched.previous(),
                    proof.after(),matched != null,proof.autonomy(),
                    proof.explanation(),proof.excerpt()));
        }
        List<LessonProgressPoint> lessonProgress = lessonTimeline(
                chronologicalLessons, history, proofRows, practice, allowed, names);
        Instant last = scores.values().stream().map(Score::updatedAt)
                .max(Instant::compareTo).orElse(null);
        return new Dashboard(studentId, child.getFullName(), grade, child.getSchoolType(),
                board.id(), board.data().title(), board.data().source(),
                confirmed, average, assessed, total, last,
                List.copyOf(topics), List.copyOf(skills), List.copyOf(trend), List.copyOf(lessons),
                List.copyOf(practice), lessonProgress);
    }

    /**
     * Replays the persisted map at actual lesson milestones, with exactly
     * one point per ended class. Existing grades are a baseline, NOT falsely
     * attributed to the first visible lesson.
     */
    private static List<LessonProgressPoint> lessonTimeline(
            List<LessonRow> chronologicalLessons, List<Change> history,
            List<Proof> proofs, List<PracticeEvidence> practice,
            Set<String> allowed, Map<String, String> names) {
        if (chronologicalLessons.isEmpty()) return List.of();
        Map<UUID, List<Change>> pointChanges = new HashMap<>();
        Map<UUID, List<LessonSkillChange>> explainedChanges = new HashMap<>();
        for (Change change : history) {
            if (!allowed.contains(change.skillId())) continue;
            UUID owningLesson = null;
            Proof best = null;

            // The strongest link is an immutable evidence source pointing
            // to this exact finished class or to an eligible homework cycle.
            for (Proof proof : proofs) {
                if (proof.after() == null || !proof.skillId().equals(change.skillId())
                        || proof.after().intValue() != change.current()
                        || Math.abs(Duration.between(proof.at(), change.at()).toSeconds()) > 120)
                    continue;
                if ("LESSON".equals(proof.sourceType())) {
                    for (LessonRow lesson : chronologicalLessons)
                        if (proof.sourceRef().startsWith(lesson.id() + ":")) {
                            owningLesson = lesson.id();
                            best = proof;
                            break;
                        }
                } else if ("HOMEWORK".equals(proof.sourceType())) {
                    for (PracticeEvidence item : practice)
                        if (item.changed() && item.cycleLessonId() != null
                                && item.skillId().equals(proof.skillId())
                                && item.sourceRef().equals(proof.sourceRef())
                                && Objects.equals(item.current(), proof.after())) {
                            owningLesson = item.cycleLessonId();
                            best = proof;
                            break;
                        }
                }
                if (owningLesson != null) break;
                // Other evidence can still explain an update performed
                // on the day of the lesson, but does not prove the lesson caused it.
                if (best == null) best = proof;
            }
            if (owningLesson == null) {
                var changedDay = change.at().atZone(java.time.ZoneId.of("Europe/Berlin")).toLocalDate();
                // Assign a same-day legacy edit once, without claiming
                // that an older map update happened during today's class.
                for (LessonRow lesson : chronologicalLessons) {
                    var lessonDay = lesson.at().atZone(java.time.ZoneId.of("Europe/Berlin")).toLocalDate();
                    if (lessonDay.equals(changedDay)) {
                        owningLesson = lesson.id();
                        break;
                    }
                }
            }
            if (owningLesson == null) continue;
            pointChanges.computeIfAbsent(owningLesson, ignored -> new ArrayList<>()).add(change);
            Proof source = best;
            String explanation = source != null && source.explanation() != null
                    && !source.explanation().isBlank() ? source.explanation()
                    : "Процент изменён в карте навыков. Подробное обоснование для этой записи не сохранено.";
            explainedChanges.computeIfAbsent(owningLesson, ignored -> new ArrayList<>())
                    .add(new LessonSkillChange(change.skillId(),
                            names.getOrDefault(change.skillId(), change.skillId()),
                            change.previous(), change.current(), change.at(),
                            source == null ? "HISTORY" : source.sourceType(),
                            explanation, source == null ? null : source.excerpt()));
        }

        Map<String, Integer> baseline = new HashMap<>();
        List<LessonProgressPoint> result = new ArrayList<>();
        for (LessonRow lesson : chronologicalLessons) {
            // Historical scores from before the first available lesson must
            // already be reflected in the first point, but have NO fake "lesson change".
            for (Change change : history) {
                if (allowed.contains(change.skillId()) && !change.at().isAfter(lesson.at()))
                    baseline.put(change.skillId(), change.current());
            }
            for (Change change : pointChanges.getOrDefault(lesson.id(), List.of()))
                baseline.put(change.skillId(), change.current());
            Integer percent = baseline.isEmpty() ? null : confirmedPercent(baseline, allowed);
            // Several updates to one skill on the same day are consolidated.
            Map<String, LessonSkillChange> unique = new LinkedHashMap<>();
            for (LessonSkillChange step : explainedChanges.getOrDefault(lesson.id(), List.of())) {
                LessonSkillChange first = unique.get(step.skillId());
                if (first == null) unique.put(step.skillId(), step);
                else unique.put(step.skillId(), new LessonSkillChange(step.skillId(),
                        step.skillTitle(), first.previous(), step.current(), step.changedAt(),
                        step.sourceType(), step.explanation(), step.excerpt()));
            }
            result.add(new LessonProgressPoint(lesson.id(), lesson.title(), lesson.at(),
                    percent, baseline.size(), List.copyOf(unique.values())));
        }
        return List.copyOf(result);
    }

    private User requireOwnChild(AuthenticatedUser parent, UUID studentId) {
        if (parent == null || parent.id() == null || parent.role() != Role.PARENT)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Parent account required");
        return users.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.id()).stream()
                .filter(s -> s.getId().equals(studentId) && s.getRole() == Role.STUDENT
                        && s.getStatus() == UserStatus.ACTIVE)
                .findFirst().orElseThrow(() ->
                        new ResponseStatusException(HttpStatus.NOT_FOUND, "Child not found"));
    }

    static List<SkillBoardService.Node> relevantSkills(SkillBoardService.Board board, String schoolType) {
        List<SkillBoardService.Node> skills = board.nodes().stream()
                .filter(node -> "skill".equals(node.kind()) && !node.archived()).toList();
        boolean tracks = skills.stream().anyMatch(node -> Boolean.TRUE.equals(node.core())
                || (node.schoolTypes() != null && !node.schoolTypes().isEmpty()));
        if (!tracks) return skills;
        return skills.stream().filter(node -> Boolean.TRUE.equals(node.core())
                || (schoolType != null && node.schoolTypes() != null
                    && node.schoolTypes().contains(schoolType))).toList();
    }

    static int confirmedPercent(Map<String,Integer> scores, Set<String> allowed) {
        if (allowed.isEmpty()) return 0;
        int sum = 0;
        for (String id : allowed) {
            Integer value = scores.get(id);
            if (value != null) sum += Math.max(0, Math.min(100, value));
        }
        return (int)Math.round((double)sum / allowed.size());
    }

    /**
     * A homework assignment is eligible only inside the period following one
     * real completed lesson. Assignments older than the first known lesson are
     * not attached retrospectively to later lessons.
     */
    static Instant homeworkCycleStart(Instant assignedAt, List<Instant> orderedLessonEnds) {
        Instant previous = null;
        for (Instant end : orderedLessonEnds) {
            if (assignedAt.isBefore(end) || assignedAt.equals(end)) return previous;
            previous = end;
        }
        return previous;
    }

    private static String normalizedSummary(String summary) {
        String safe = Objects.toString(summary,"").replaceAll("[\\r\\n\\t]+"," ").strip();
        return safe.isEmpty() ? null : safe.substring(0,Math.min(550,safe.length()));
    }
}
