package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassStatus;
import com.mcschool.flashcard.liveclasses.PersonalBoard;
import com.mcschool.flashcard.skills.SkillBoardService;
import com.mcschool.flashcard.skills.SkillEvidenceService;
import com.mcschool.flashcard.skills.SkillMasteryService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Server-owned post-lesson skill review, independent of post-lesson homework.
 * Called only after the teacher's End for all transaction commits; the browser
 * has already exported all personal board PDFs before making that request.
 * A durable job survives app restarts, and completed pupils are never retried.
 */
@Service
public class PostLessonSkillReviewService {
    private static final Logger LOG = LoggerFactory.getLogger(PostLessonSkillReviewService.class);
    private static final int MAX_ATTEMPTS = 3;
    private static final int MAX_PUPILS = 25;
    private static final int MAX_PDFS = 2;

    private record Job(UUID classId, UUID teacherId, String eventId, String rosterJson, int attempts) {}
    private record StudentResult(String state, String boardId, String detail,
                                 List<PostLessonSkillAnalysisService.Observation> proposals) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final OnlineClassRepository classes;
    private final OnlineClassAccessService classAccess;
    private final LessonParticipantsService lessonParticipants;
    private final StudentGroupMemberRepository groupMembers;
    private final UserRepository users;
    private final SkillBoardService boards;
    private final SkillMasteryService mastery;
    private final SkillEvidenceService evidence;
    private final LessonPreparationRepository preparations;
    private final PostLessonSkillAnalysisService analyzer;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "mindcrafti-post-lesson-skill-review");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final UUID workerId = UUID.randomUUID();

    public PostLessonSkillReviewService(JdbcTemplate jdbc, ObjectMapper json,
            PlatformTransactionManager manager, OnlineClassRepository classes,
            OnlineClassAccessService classAccess, LessonParticipantsService lessonParticipants,
            StudentGroupMemberRepository groupMembers, UserRepository users,
            SkillBoardService boards, SkillMasteryService mastery,
            SkillEvidenceService evidence, LessonPreparationRepository preparations,
            PostLessonSkillAnalysisService analyzer) {
        this.jdbc=jdbc; this.json=json; this.tx=new TransactionTemplate(manager);
        this.classes=classes; this.classAccess=classAccess; this.lessonParticipants=lessonParticipants;
        this.groupMembers=groupMembers; this.users=users; this.boards=boards;
        this.mastery=mastery; this.evidence=evidence; this.preparations=preparations;
        this.analyzer=analyzer;
    }

    /** This method must run AFTER the room-end database transaction commits. */
    @Transactional
    public void enqueueEndedClass(UUID classId) {
        OnlineClass room = classes.findById(classId).orElse(null);
        if(room == null || room.getStatus() != OnlineClassStatus.ENDED
                || room.getEventId() == null || room.getEventId().isBlank()
                || room.isTeacherOnly()) return;
        UUID teacherId = room.getTeacher().getId();
        List<User> pupils;
        if (lessonParticipants.hasLesson(teacherId,room.getEventId())) {
            pupils = lessonParticipants.students(teacherId,room.getEventId());
        } else if (room.getGroup()!=null) {
            pupils = groupMembers.findAllByGroupIdOrderByStudentFullNameAsc(room.getGroup().getId())
                    .stream().map(member->member.getStudent()).toList();
        } else if (room.getStudent()!=null) {
            pupils = List.of(room.getStudent());
        } else {
            return;
        }
        List<String> roster = pupils.stream()
                .filter(student->student.getRole()==Role.STUDENT
                        && student.getStatus()==UserStatus.ACTIVE && !student.isArchived()
                        && student.getTeacher()!=null && teacherId.equals(student.getTeacher().getId()))
                .map(student->student.getId().toString()).distinct().limit(MAX_PUPILS+1).toList();
        if(roster.isEmpty() || roster.size()>MAX_PUPILS) return;
        jdbc.update("""
            INSERT INTO post_lesson_skill_review_jobs
                (class_id,teacher_id,event_id,roster_json,total_students)
            VALUES(?,?,?,CAST(? AS jsonb),?)
            ON CONFLICT(class_id) DO NOTHING
            """,classId,teacherId,room.getEventId(),json.writeValueAsString(roster),roster.size());
        LOG.info("Skill review queued class={} pupils={}",classId,roster.size());
    }

    /** Ownership-safe diagnostic; does not leak a different teacher's class. */
    @Transactional(readOnly=true)
    public Map<String,Object> status(AuthenticatedUser teacher,UUID classId) {
        classAccess.requireHost(teacher,classId);
        List<Map<String,Object>> jobs=jdbc.query("""
            SELECT state,total_students,processed_students,attempts,failure_code,finished_at
            FROM post_lesson_skill_review_jobs WHERE class_id=?
            """,(rs,i)->{
                Map<String,Object> row=new LinkedHashMap<>();
                row.put("state",rs.getString("state"));
                row.put("totalStudents",rs.getInt("total_students"));
                row.put("processedStudents",rs.getInt("processed_students"));
                row.put("attempts",rs.getInt("attempts"));
                row.put("failureCode",Objects.toString(rs.getString("failure_code"),""));
                row.put("finishedAt",rs.getTimestamp("finished_at")==null?"":rs.getTimestamp("finished_at").toInstant().toString());
                return row;
            },classId);
        if(jobs.isEmpty())return Map.of("state","NONE");
        var status=new LinkedHashMap<>(jobs.get(0));
        status.put("students",jdbc.query("""
            SELECT student_id,state,observations,mastery_updates,detail,board_id
            FROM post_lesson_skill_review_students WHERE class_id=?
            ORDER BY student_id
            """,(rs,i)->Map.of("studentId",rs.getObject("student_id",UUID.class).toString(),
                    "state",rs.getString("state"),"observations",rs.getInt("observations"),
                    "masteryUpdates",rs.getInt("mastery_updates"),
                    "detail",Objects.toString(rs.getString("detail"),""),
                    "boardId",Objects.toString(rs.getString("board_id"),"")),classId));
        return status;
    }

    @Scheduled(fixedDelayString="${app.post-lesson-skill-review.poll-ms:6000}",initialDelayString="${app.post-lesson-skill-review.initial-ms:14000}")
    public void tick() {
        if (!busy.compareAndSet(false,true)) return;
        Job job=null;
        try {
            job=tx.execute(st->claim());
            if(job==null){busy.set(false);return;}
            final Job selected=job;
            worker.submit(()->{
                try { process(selected); }
                catch(Exception failure) { fail(selected,failure); }
                finally { busy.set(false); }
            });
        } catch(RuntimeException failure) {
            busy.set(false);
            LOG.warn("Skill review queue exception type={}",failure.getClass().getSimpleName());
        }
    }

    private Job claim() {
        jdbc.update("""
            UPDATE post_lesson_skill_review_jobs
            SET state='QUEUED',worker_id=NULL,lease_until=NULL,updated_at=now()
            WHERE state='RUNNING' AND lease_until<now() AND attempts<?
            """,MAX_ATTEMPTS);
        jdbc.update("""
            UPDATE post_lesson_skill_review_jobs
            SET state='FAILED',failure_code='WORKER_INTERRUPTED',worker_id=NULL,
                lease_until=NULL,finished_at=now(),updated_at=now()
            WHERE state='RUNNING' AND lease_until<now() AND attempts>=?
            """,MAX_ATTEMPTS);
        return jdbc.query("""
            UPDATE post_lesson_skill_review_jobs
            SET state='RUNNING',attempts=attempts+1,worker_id=?,
                lease_until=now()+INTERVAL '15 minutes',updated_at=now()
            WHERE class_id=(
                SELECT class_id FROM post_lesson_skill_review_jobs
                WHERE state='QUEUED' AND created_at < now()-INTERVAL '35 seconds'
                  AND attempts < ?
                ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
            )
            RETURNING class_id,teacher_id,event_id,roster_json::text,attempts
            """,(rs,i)->new Job(rs.getObject("class_id",UUID.class),
                    rs.getObject("teacher_id",UUID.class),rs.getString("event_id"),
                    rs.getString("roster_json"),rs.getInt("attempts")),workerId,MAX_ATTEMPTS)
                .stream().findFirst().orElse(null);
    }

    private void process(Job job)throws Exception {
        @SuppressWarnings("unchecked")
        List<String> roster = json.readValue(job.rosterJson(),List.class);
        if (roster.size()>MAX_PUPILS) throw new IllegalStateException("SKILL_REVIEW_ROSTER_TOO_LARGE");
        for (String entry : roster) {
            UUID studentId=UUID.fromString(entry);
            boolean already=Boolean.TRUE.equals(tx.execute(st->jdbc.query("""
                SELECT 1 FROM post_lesson_skill_review_students WHERE class_id=? AND student_id=?
                """,(rs,i)->1,job.classId(),studentId).stream().findFirst().isPresent()));
            if(already)continue;
            // The model runs OUTSIDE transactions. This service never locks the
            // classroom or the pupil's board while waiting on an AI provider.
            StudentResult result=review(job,studentId);
            tx.executeWithoutResult(st->commitPupil(job,studentId,result));
        }
        tx.executeWithoutResult(st->{
            Integer errors=jdbc.queryForObject("""
                SELECT count(*) FROM post_lesson_skill_review_students
                WHERE class_id=? AND state='ERROR'
                """,Integer.class,job.classId());
            jdbc.update("""
                UPDATE post_lesson_skill_review_jobs
                SET state=?,failure_code=?,processed_students=total_students,
                    finished_at=now(),worker_id=NULL,lease_until=NULL,updated_at=now()
                WHERE class_id=? AND worker_id=? AND state='RUNNING'
                """,errors!=null&&errors>0?"PARTIAL":"DONE",
                    errors!=null&&errors>0?"SOME_PUPILS_SKIPPED":null,
                    job.classId(),workerId);
        });
        LOG.info("Skill review complete class={}",job.classId());
    }

    private StudentResult review(Job job,UUID studentId)throws Exception {
        if(!users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
                studentId,job.teacherId(),Role.STUDENT,UserStatus.ACTIVE))
            return new StudentResult("ERROR",null,"STUDENT_NO_LONGER_ASSIGNED",List.of());
        User student=users.findById(studentId).orElseThrow();
        if(student.getGrade()==null)
            return new StudentResult("NO_BOARD",null,"STUDENT_GRADE_UNSET",List.of());
        var matches=boards.list().stream().filter(board->board.grade()==student.getGrade()).toList();
        if(matches.isEmpty())
            return new StudentResult("NO_BOARD",null,"GRADE_BOARD_NOT_FOUND",List.of());
        SkillBoardService.Snapshot board=boards.get(matches.get(0).id());
        List<SkillBoardService.Node> allowed=board.data().nodes().stream()
                .filter(node->"skill".equals(node.kind()) && !node.archived()
                        && (node.schoolTypes()==null || node.schoolTypes().isEmpty()
                        || node.schoolTypes().contains(student.getSchoolType())))
                .toList();
        if(allowed.isEmpty())return new StudentResult("NO_BOARD",board.id(),"NO_MATCHING_SKILLS",List.of());

        String personal=PersonalBoard.targetIdFor(studentId);
        String workbook=PersonalBoard.workbookTargetIdFor(studentId);
        Integer strokes=jdbc.queryForObject("""
            SELECT count(*) FROM online_class_annotation_events ev
            JOIN online_class_annotation_documents doc ON doc.id=ev.document_id
            WHERE doc.class_id=? AND doc.target_type='WHITEBOARD'
              AND doc.target_id IN (?,?) AND ev.actor_id=?
              AND ev.operation_type IN ('ADD','UPDATE')
            """,Integer.class,job.classId(),personal,workbook,studentId);
        String transcript=attributedTranscript(job,studentId);
        if((strokes==null || strokes==0) && !transcript.contains("STUDENT "))
            return new StudentResult("NO_EVIDENCE",board.id(),"NO_PUPIL_WORK_OR_SPEECH",List.of());
        List<PostLessonSkillAnalysisService.SourcePdf> files=new ArrayList<>();
        jdbc.query("""
            SELECT board_id,pdf FROM completed_lesson_documents
            WHERE class_id=? AND teacher_id=? AND board_id IN (?,?)
            ORDER BY CASE WHEN board_id=? THEN 0 ELSE 1 END,updated_at DESC
            """,rs->{
                if(files.size()>=MAX_PDFS)return;
                byte[] pdf=rs.getBytes("pdf");
                if(pdf!=null && pdf.length<=8_000_000 && pdf.length>=5)
                    files.add(new PostLessonSkillAnalysisService.SourcePdf(rs.getString("board_id"),pdf));
            },job.classId(),job.teacherId(),workbook,personal,workbook);
        if(files.isEmpty() && !transcript.contains("STUDENT "))
            return new StudentResult("NO_EVIDENCE",board.id(),"ANNOTATED_PDF_NOT_SAVED",List.of());

        StringBuilder notes=new StringBuilder();
        preparations.findByTeacherIdAndEventId(job.teacherId(),job.eventId()).ifPresent(p->{
            notes.append("Covered material: ").append(Objects.toString(p.getCoveredMaterial(),"")).append('\n');
            notes.append("Lesson plan: ").append(Objects.toString(p.getLessonPlan(),"")).append('\n');
            notes.append("Difficulties noted: ").append(Objects.toString(p.getDifficulties(),""));
        });
        List<PostLessonSkillAnalysisService.Observation> proposals=analyzer.analyze(
                student.getFullName(),student.getGrade(),student.getSchoolType(),
                allowed,notes.toString(),transcript,files);
        return new StudentResult(proposals.isEmpty()?"NO_EVIDENCE":"RECORDED",
                board.id(),proposals.isEmpty()?"NO_CONFIRMED_SKILL_EVIDENCE":"",proposals);
    }

    private String attributedTranscript(Job job,UUID pupil) {
        StringBuilder result=new StringBuilder();
        jdbc.query("""
            SELECT user_id,start_ms,text FROM online_class_transcript_segments
            WHERE class_id=? ORDER BY start_ms,id
            """,rs->{
                UUID speaker=rs.getObject("user_id",UUID.class);
                if(!pupil.equals(speaker)&&!job.teacherId().equals(speaker))return;
                String text=Objects.toString(rs.getString("text"),"").strip();
                if(text.isEmpty() || result.length()>=18000)return;
                String who=pupil.equals(speaker)?"STUDENT":"TEACHER";
                String label=who+" [t="+rs.getLong("start_ms")/1000+"s]: ";
                int remaining=Math.max(0,18000-result.length()-label.length()-2);
                result.append(label).append(text,0,Math.min(remaining,text.length())).append('\n');
            },job.classId());
        return result.toString();
    }

    private void commitPupil(Job job,UUID pupil,StudentResult result) {
        Integer owned=jdbc.queryForObject("""
            SELECT count(*) FROM post_lesson_skill_review_jobs
            WHERE class_id=? AND worker_id=? AND state='RUNNING' AND lease_until>now()
            """,Integer.class,job.classId(),workerId);
        if(owned==null || owned!=1)throw new IllegalStateException("SKILL_REVIEW_WORKER_LEASE_LOST");
        AuthenticatedUser teacher=new AuthenticatedUser(job.teacherId(),null,Role.TEACHER);
        int updates=0;
        if(result.boardId()!=null && !result.proposals().isEmpty()){
            Map<String,Integer> before=mastery.get(result.boardId(),pupil,teacher).mastery();
            for(var candidate:result.proposals()){
                Integer next=masteryAfter(before.get(candidate.skillId()),candidate);
                String key="post-lesson:"+job.classId()+":"+candidate.skillId();
                var observation=new SkillEvidenceService.Observation(candidate.skillId(),"LESSON",
                        job.classId().toString(),candidate.autonomy(),candidate.explanation(),
                        candidate.excerpt(),Instant.now(),next,null,null,key);
                evidence.record(result.boardId(),pupil,observation,teacher);
                if(next!=null && !Objects.equals(next,before.get(candidate.skillId())))updates++;
            }
        }
        jdbc.update("""
            INSERT INTO post_lesson_skill_review_students
                (class_id,student_id,board_id,state,observations,mastery_updates,detail)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(class_id,student_id) DO NOTHING
            """,job.classId(),pupil,result.boardId(),result.state(),
                result.proposals().size(),updates,result.detail());
        jdbc.update("""
            UPDATE post_lesson_skill_review_jobs
            SET processed_students=(SELECT count(*) FROM post_lesson_skill_review_students WHERE class_id=?),
                lease_until=now()+INTERVAL '15 minutes',updated_at=now()
            WHERE class_id=? AND worker_id=? AND state='RUNNING'
            """,job.classId(),job.classId(),workerId);
    }

    /** Never infer 100% mastery, lower a score on one mistake, or treat a topic as evidence. */
    static Integer masteryAfter(Integer previous,PostLessonSkillAnalysisService.Observation proposal) {
        if(proposal.confidence()<93 || proposal.correctExamples()<2
                || !"CORRECT".equals(proposal.correctness())
                || !Set.of("FIRST_TRY","INDEPENDENT").contains(proposal.autonomy())) return null;
        return previous==null?60:Math.min(95,previous+5);
    }

    private void fail(Job job,Exception failure) {
        LOG.warn("Skill review job class={} failed attempt={} type={}",
                job.classId(),job.attempts(),failure.getClass().getSimpleName());
        try {
            tx.executeWithoutResult(st->jdbc.update("""
                UPDATE post_lesson_skill_review_jobs
                SET state=?,failure_code=?,worker_id=NULL,lease_until=NULL,
                    updated_at=now(),finished_at=CASE WHEN ?>=? THEN now() ELSE NULL END
                WHERE class_id=? AND worker_id=? AND state='RUNNING'
                """,job.attempts()>=MAX_ATTEMPTS?"FAILED":"QUEUED",
                    "ANALYSIS_OR_STORAGE_FAILED",job.attempts(),MAX_ATTEMPTS,
                    job.classId(),workerId));
        } catch(RuntimeException persistenceFailure) {
            LOG.warn("Could not persist skill-review failure class={}",job.classId());
        }
    }

    @PreDestroy
    void close() {worker.shutdownNow();}
}
