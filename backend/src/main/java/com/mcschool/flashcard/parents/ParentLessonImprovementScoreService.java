package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.skills.SkillBoardService;
import com.mcschool.flashcard.skills.SkillEvidenceService;
import com.mcschool.flashcard.skills.SkillMasteryService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * A verified before/after transcript comparison can become a small, auditable
 * skill update; all displayed percentages still come from canonical mastery.
 * Never assigns a score for merely discussing a topic, teacher praise, or an
 * ambiguous curriculum match. The row lock and evidence key prevent double
 * increases after retries or app restarts.
 */
@Service
public class ParentLessonImprovementScoreService {
    private static final Logger LOG = LoggerFactory.getLogger(ParentLessonImprovementScoreService.class);
    private static final int MAX_MASTERY = 95;
    private static final Set<String> STOP = Set.of(
            "пони", "умени", "улуч", "вычи", "прав", "пров", "само", "пояс",
            "спос", "отве", "числ", "зада", "перв", "ранее", "тепе", "урок",
            "запи", "посл", "прим", "разбо");

    private record Pending(UUID classId, UUID studentId, UUID teacherId,
                           Instant endedAt, String improvementsJson) {}

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final ObjectMapper json;
    private final UserRepository users;
    private final SkillBoardService boards;
    private final SkillMasteryService mastery;
    private final SkillEvidenceService evidence;

    public ParentLessonImprovementScoreService(JdbcTemplate jdbc, TransactionTemplate transaction,
            ObjectMapper json, UserRepository users, SkillBoardService boards,
            SkillMasteryService mastery, SkillEvidenceService evidence) {
        this.jdbc=jdbc;this.transaction=transaction;this.json=json;this.users=users;
        this.boards=boards;this.mastery=mastery;this.evidence=evidence;
    }

    @Scheduled(initialDelay = 20000, fixedDelay = 20000)
    public void scorePendingRecaps() {
        try {
            transaction.executeWithoutResult(status -> {
                List<Pending> pending=jdbc.query("""
                    SELECT r.class_id,r.student_id,c.teacher_id,
                           coalesce(c.actual_end_at,c.scheduled_end_at) AS ended_at,
                           r.improvements::text
                    FROM parent_lesson_recaps r
                    JOIN online_classes c ON c.id=r.class_id
                    JOIN users u ON u.id=r.student_id
                    WHERE r.state='DONE' AND r.scoring_checked_at IS NULL
                      AND jsonb_array_length(r.improvements)>0
                      AND c.status='ENDED' AND u.role='STUDENT'
                      AND NOT EXISTS(
                        SELECT 1 FROM post_lesson_skill_review_jobs job
                        WHERE job.class_id=c.id AND job.state IN ('QUEUED','RUNNING')
                      )
                    ORDER BY CASE WHEN u.parent_id IS NOT NULL THEN 0 ELSE 1 END,
                             coalesce(c.actual_end_at,c.scheduled_end_at) DESC
                    FOR UPDATE OF r SKIP LOCKED LIMIT 1
                    """,(rs,i)->new Pending(rs.getObject("class_id",UUID.class),
                            rs.getObject("student_id",UUID.class),
                            rs.getObject("teacher_id",UUID.class),
                            rs.getTimestamp("ended_at").toInstant(),
                            rs.getString("improvements")));
                if(!pending.isEmpty()) score(pending.get(0));
            });
        } catch(Exception failure) {
            LOG.warn("Skill progress scoring skipped type={}",failure.getClass().getSimpleName());
        }
    }

    private void score(Pending row) {
        List<Map<String,Object>> improvements;
        try {
            @SuppressWarnings("unchecked")
            List<Map<String,Object>> parsed=json.readValue(row.improvementsJson(),List.class);
            improvements=parsed;
        } catch(Exception invalid) {
            markChecked(row,List.of());
            return;
        }
        User student=users.findById(row.studentId()).orElse(null);
        if(student==null || student.isArchived() || student.getRole()!=Role.STUDENT
                || student.getStatus()!=UserStatus.ACTIVE || student.getGrade()==null
                || student.getTeacher()==null
                || !row.teacherId().equals(student.getTeacher().getId())) {
            markAll(improvements,"NOT_ELIGIBLE");
            markChecked(row,improvements);
            return;
        }

        var candidateBoards=boards.list().stream()
                .filter(b->b.grade()==student.getGrade()).toList();
        if(candidateBoards.size()!=1) {
            markAll(improvements,"BOARD_NOT_UNIQUE");
            markChecked(row,improvements);
            return;
        }
        var board=boards.get(candidateBoards.get(0).id());
        List<SkillBoardService.Node> allowed=board.data().nodes().stream()
                .filter(n->"skill".equals(n.kind()) && !n.archived()
                        && (Boolean.TRUE.equals(n.core()) || n.schoolTypes()==null
                            || n.schoolTypes().isEmpty()
                            || (student.getSchoolType()!=null &&
                                n.schoolTypes().contains(student.getSchoolType())))).toList();
        AuthenticatedUser teacher=new AuthenticatedUser(row.teacherId(),null,Role.TEACHER);
        Map<String,Integer> values=new LinkedHashMap<>(mastery.get(board.id(),row.studentId(),teacher).mastery());
        Set<String> handled=new HashSet<>();
        int changed=0;
        for(Map<String,Object> improvement:improvements) {
            String beforeQuote=Objects.toString(improvement.get("beforeQuote"),"").strip();
            String afterQuote=Objects.toString(improvement.get("afterQuote"),"").strip();
            String description=Objects.toString(improvement.get("explanation"),"").strip();
            String mode=Objects.toString(improvement.get("comparison"),"");
            String topic=Objects.toString(improvement.get("topic"),"");
            if(beforeQuote.isBlank() || afterQuote.isBlank() || description.isBlank()
                    || !Set.of("BETWEEN_LESSONS","WITHIN_LESSON").contains(mode)) {
                improvement.put("scoreStatus","NOT_VERIFIED");continue;
            }
            // LLM-selected or previously recorded skill IDs must still resolve
            // to the EXACT currently applicable pupil curriculum.
            String suggested=Objects.toString(improvement.get("skillId"),"");
            SkillBoardService.Node skill=allowed.stream().filter(n->n.id().equals(suggested))
                    .findFirst().orElseGet(()->uniqueTopicSkill(topic,allowed));
            if(skill==null) {
                improvement.put("scoreStatus","SKILL_NOT_UNAMBIGUOUS");continue;
            }
            improvement.put("skillId",skill.id());
            if(!handled.add(skill.id())) {
                improvement.put("scoreStatus","SAME_SKILL_ALREADY_HANDLED");continue;
            }
            Integer earlier=values.get(skill.id());
            improvement.put("masteryBefore",earlier);
            // A normal lesson skill review has priority. The retrospective
            // comparison is not a second bonus for the same work.
            Integer priorReviewed=jdbc.queryForObject("""
                SELECT count(*) FROM student_skill_evidence
                WHERE student_id=? AND board_id=? AND skill_id=?
                  AND source_type='LESSON' AND source_ref LIKE ?
                  AND mastery_after IS NOT NULL
                """,Integer.class,row.studentId(),board.id(),skill.id(),
                    row.classId()+":%");
            if(priorReviewed!=null && priorReviewed>0) {
                improvement.put("scoreStatus","ALREADY_GRADED");
                improvement.put("masteryAfter",earlier);
                continue;
            }
            if(earlier!=null && earlier>=MAX_MASTERY) {
                improvement.put("scoreStatus","AT_MASTERY_CAP");
                improvement.put("masteryAfter",earlier);
                continue;
            }
            int next=earlier==null?60:Math.min(MAX_MASTERY,earlier+5);
            String reason="Подтверждённое сравнение решений: ранее — "
                    +Objects.toString(improvement.get("before"),"")
                    +"; затем — "+Objects.toString(improvement.get("after"),"")
                    +". "+description;
            if(reason.length()>1200)reason=reason.substring(0,1200);
            String key="parent-recap:"+row.classId()+":"+skill.id();
            SkillEvidenceService.Observation proof=new SkillEvidenceService.Observation(
                    skill.id(),"LESSON",row.classId()+":parent-recap-comparison",
                    "INDEPENDENT",reason,afterQuote,
                    row.endedAt(),next,null,null,key);
            var saved=evidence.record(board.id(),row.studentId(),proof,teacher);
            if(!saved.replayed()) changed++;
            improvement.put("scoreStatus",saved.replayed()?"ALREADY_GRADED":"SCORED");
            improvement.put("masteryAfter",next);
            values.put(skill.id(),next);
        }
        markChecked(row,improvements);
        if(changed>0) LOG.info("Parent lesson skill scores class={} pupil={} updates={}",
                row.classId(),row.studentId(),changed);
    }

    /** Match only one distinctive skill on the official board, never an inferred guess. */
    static SkillBoardService.Node uniqueTopicSkill(String topic,List<SkillBoardService.Node> allowed) {
        Set<String> words=roots(topic);
        if(words.isEmpty())return null;
        int best=0;
        boolean tied=false;
        SkillBoardService.Node winner=null;
        for(var skill:allowed) {
            Set<String> tokens=roots(skill.title());
            int overlap=0;
            for(String term:words)if(tokens.contains(term))overlap++;
            if(overlap>best) {best=overlap;winner=skill;tied=false;}
            else if(overlap>0 && overlap==best) tied=true;
        }
        return best==0 || tied?null:winner;
    }

    private static Set<String> roots(String words) {
        Set<String> roots=new HashSet<>();
        if(words==null)return roots;
        String clean=words.toLowerCase(Locale.ROOT).replace('ё','е');
        for(String word:clean.split("[^\\p{L}]+")) {
            if(word.length()<4)continue;
            String root=word.substring(0,4);
            if(!STOP.contains(root))roots.add(root);
        }
        return roots;
    }

    private static void markAll(List<Map<String,Object>> changes,String reason) {
        for(var item:changes)item.put("scoreStatus",reason);
    }
    private void markChecked(Pending row,List<Map<String,Object>> changes) {
        jdbc.update("""
            UPDATE parent_lesson_recaps
            SET improvements=CAST(? AS jsonb),scoring_checked_at=now(),updated_at=now()
            WHERE class_id=? AND student_id=? AND scoring_checked_at IS NULL
            """,json.writeValueAsString(changes),row.classId(),row.studentId());
    }
}
