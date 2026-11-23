package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.liveclasses.*;
import com.mcschool.flashcard.skills.*;
import com.mcschool.flashcard.users.*;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Durable, post-commit, lesson-specific review of every authorized pupil.
 * Never changes the shared curriculum; all observations use MCH3's existing
 * evidence store and append-only history, with a conservative mastery gate.
 */
@Service
public class PostLessonSkillReviewJobService {
    private static final Logger LOG=LoggerFactory.getLogger(PostLessonSkillReviewJobService.class);
    public record LessonEnded(UUID classId, UUID teacherId, String eventId) {}
    private record Job(UUID classId,UUID teacherId,String eventId,List<UUID> students) {}
    private record PupilWork(String boardId,List<SkillBoardService.Node> skills,
             List<PostLessonSkillReviewAiService.SourcePdf> pdfs,
             String pupilSpeech,String teacherSpeech,Set<String> pupilInkLocations,
             Instant observedAt, String noDataCode) {}
    private record Outcome(String state,String boardId,
            List<PostLessonSkillReviewAiService.Finding> findings,
            Set<String> pupilInkLocations,Instant observedAt,String detail) {}

    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final OnlineClassRepository classes;
    private final UserRepository users;
    private final LessonParticipantsService participants;
    private final StudentGroupMemberRepository groupMembers;
    private final SkillBoardService boards;
    private final SkillMasteryService mastery;
    private final SkillEvidenceService evidence;
    private final PostLessonSkillReviewAiService ai;
    private final ExecutorService executor=Executors.newSingleThreadExecutor(r->{
        Thread t=new Thread(r,"mindcrafti-skill-review");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean busy=new AtomicBoolean(false);
    private final UUID workerId=UUID.randomUUID();

    public PostLessonSkillReviewJobService(JdbcTemplate db,PlatformTransactionManager manager,
            ObjectMapper json,OnlineClassRepository classes,UserRepository users,
            LessonParticipantsService participants,StudentGroupMemberRepository groupMembers,
            SkillBoardService boards,SkillMasteryService mastery,
            SkillEvidenceService evidence,PostLessonSkillReviewAiService ai){
        this.db=db;this.tx=new TransactionTemplate(manager);this.json=json;this.classes=classes;
        this.users=users;this.participants=participants;this.groupMembers=groupMembers;
        this.boards=boards;this.mastery=mastery;this.evidence=evidence;this.ai=ai;
    }

    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    public void onLessonEnded(LessonEnded event){
        try{
            // The classroom end transaction has committed. Analysis must NEVER
            // prevent a teacher from ending their call.
            tx.executeWithoutResult(status->enqueue(event));
        }catch(Exception failure){
            LOG.warn("Skill review enqueue failed class={} type={}",event.classId(),
                    failure.getClass().getSimpleName());
        }
    }

    private void enqueue(LessonEnded event){
        OnlineClass room=classes.findById(event.classId()).orElse(null);
        if(room==null||room.getStatus()!=OnlineClassStatus.ENDED
                ||!room.getTeacher().getId().equals(event.teacherId())
                ||!Objects.equals(room.getEventId(),event.eventId()))return;
        List<User> roster;
        if(participants.hasLesson(event.teacherId(),event.eventId())){
            roster=participants.students(event.teacherId(),event.eventId());
        }else if(room.getGroup()!=null){
            roster=groupMembers.findAllByGroupIdOrderByStudentFullNameAsc(room.getGroup().getId())
                    .stream().map(member->member.getStudent()).toList();
        }else if(room.getStudent()!=null) roster=List.of(room.getStudent());
        else roster=List.of();

        List<String> safe=new ArrayList<>();
        for(User student:roster){
            if(student.getRole()!=Role.STUDENT||student.isArchived()||student.getStatus()!=UserStatus.ACTIVE
                    ||student.getTeacher()==null||!event.teacherId().equals(student.getTeacher().getId()))continue;
            String id=student.getId().toString();
            if(!safe.contains(id))safe.add(id);
        }
        if(safe.isEmpty()||safe.size()>25)return;
        db.update("""
            INSERT INTO post_lesson_skill_review_jobs
                (class_id,teacher_id,event_id,roster_json,total_students)
            VALUES (?,?,?,CAST(? AS jsonb),?)
            ON CONFLICT(class_id) DO NOTHING
            """,event.classId(),event.teacherId(),event.eventId(),
                json.writeValueAsString(safe),safe.size());
        LOG.info("Skill review queued class={} pupils={}",event.classId(),safe.size());
    }

    /** Read-only, teacher-scoped progress status, including non-existent jobs. */
    public Map<String,Object> status(AuthenticatedUser teacher,UUID classId){
        if(teacher==null||teacher.role()!=Role.TEACHER)return Map.of("state","NONE");
        OnlineClass room=classes.findById(classId).orElse(null);
        if(room==null||!room.getTeacher().getId().equals(teacher.id()))return Map.of("state","NONE");
        List<Map<String,Object>> jobs=db.queryForList("""
            SELECT state,total_students,processed_students,COALESCE(failure_code,'') AS failure_code
            FROM post_lesson_skill_review_jobs WHERE class_id=? AND teacher_id=?
            """,classId,teacher.id());
        if(jobs.isEmpty())return Map.of("state","NONE");
        List<Map<String,Object>> rows=db.queryForList("""
            SELECT student_id,state,observations,mastery_updates,COALESCE(detail,'') AS detail
            FROM post_lesson_skill_review_students WHERE class_id=?
            ORDER BY student_id
            """,classId);
        Map<String,Object> response=new LinkedHashMap<>(jobs.get(0));
        response.put("students",rows);
        return response;
    }

    public Map<String,Object> retry(AuthenticatedUser teacher,UUID classId){
        if(teacher==null||teacher.role()!=Role.TEACHER)return Map.of("state","NONE");
        OnlineClass room=classes.findById(classId).orElse(null);
        if(room==null||room.getStatus()!=OnlineClassStatus.ENDED
                ||!room.getTeacher().getId().equals(teacher.id()))return Map.of("state","NONE");
        int updated=db.update("""
            UPDATE post_lesson_skill_review_jobs
            SET state='QUEUED',attempts=0,worker_id=NULL,lease_until=NULL,
                failure_code=NULL,finished_at=NULL,updated_at=now()
            WHERE class_id=? AND teacher_id=? AND state IN ('FAILED','PARTIAL')
            """,classId,teacher.id());
        if(updated!=0)db.update("""
            DELETE FROM post_lesson_skill_review_students
            WHERE class_id=? AND state='ERROR'
            """,classId);
        return status(teacher,classId);
    }

    @Scheduled(fixedDelay=4000,initialDelay=10000)
    public void tick(){
        if(!ai.configured()||!busy.compareAndSet(false,true))return;
        try{
            executor.execute(()->{
                try{
                    UUID classId=claim();
                    if(classId!=null)process(classId);
                }catch(Exception error){
                    LOG.warn("Skill review worker error type={}",error.getClass().getSimpleName());
                }finally{busy.set(false);}
            });
        }catch(RuntimeException error){busy.set(false);}
    }

    private UUID claim(){
        return tx.execute(st->{
            List<UUID> ids=db.query("""
                WITH next AS (
                    SELECT class_id FROM post_lesson_skill_review_jobs
                    WHERE ((state='QUEUED' AND created_at<now()-interval '20 seconds')
                        OR (state='RUNNING' AND lease_until<now()))
                        AND attempts<3
                    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                UPDATE post_lesson_skill_review_jobs AS j SET state='RUNNING',
                    attempts=j.attempts+1,worker_id=?,lease_until=now()+interval '15 minutes',
                    updated_at=now()
                FROM next WHERE j.class_id=next.class_id
                RETURNING j.class_id
                """,(rs,i)->rs.getObject(1,UUID.class),workerId);
            return ids.isEmpty()?null:ids.get(0);
        });
    }

    @SuppressWarnings("unchecked")
    private Job job(UUID classId){
        return tx.execute(st->{
            List<Job> jobs=db.query("""
                SELECT teacher_id,event_id,roster_json::text AS roster
                FROM post_lesson_skill_review_jobs WHERE class_id=? AND worker_id=?
                """,(rs,i)->{
                    List<?> raw=json.readValue(rs.getString("roster"),List.class);
                    List<UUID> ids=new ArrayList<>();
                    for(Object value:raw)if(value instanceof String s)ids.add(UUID.fromString(s));
                    return new Job(classId,rs.getObject("teacher_id",UUID.class),
                            rs.getString("event_id"),List.copyOf(ids));
                },classId,workerId);
            return jobs.isEmpty()?null:jobs.get(0);
        });
    }

    private void process(UUID classId){
        try{
            Job job=job(classId);
            if(job==null)return;
            for(UUID studentId:job.students()){
                if(alreadyDone(classId,studentId))continue;
                if(!renew(classId))return;
                try{
                    PupilWork material=tx.execute(st->load(job,studentId));
                    Outcome output=material.noDataCode()!=null
                        ?new Outcome(material.noDataCode(),material.boardId(),List.of(),
                                material.pupilInkLocations(),material.observedAt(),material.noDataCode())
                        :new Outcome("RECORDED",material.boardId(),
                                ai.assess(material.skills(),material.pdfs(),material.pupilSpeech(),
                                        material.teacherSpeech(),material.pupilInkLocations()),
                                material.pupilInkLocations(),material.observedAt(),null);
                    commitPupil(job,studentId,output);
                }catch(Exception pupilError){
                    LOG.warn("Skill review pupil failed class={} student={} type={}",
                            classId,studentId,pupilError.getClass().getSimpleName());
                    try{commitPupil(job,studentId,new Outcome("ERROR",null,List.of(),
                            Set.of(),Instant.now(),"REVIEW_FAILURE"));}catch(Exception ignored){
                        throw new IllegalStateException("SKILL_REVIEW_PERSIST_FAILED",ignored);
                    }
                }
            }
            tx.executeWithoutResult(st->{
                if(!owns(classId))return;
                List<Map<String,Object>> counts=db.queryForList("""
                    SELECT state,COUNT(*) AS n FROM post_lesson_skill_review_students
                    WHERE class_id=? GROUP BY state
                    """,classId);
                int processed=0,errors=0;
                for(var count:counts) {
                    int n=((Number)count.get("n")).intValue();
                    processed+=n;
                    if("ERROR".equals(count.get("state")))errors+=n;
                }
                String state=processed<job.students().size()?"FAILED":errors>0?"PARTIAL":"DONE";
                db.update("""
                    UPDATE post_lesson_skill_review_jobs
                    SET state=?,processed_students=?,lease_until=NULL,worker_id=NULL,
                        failure_code=?,finished_at=now(),updated_at=now()
                    WHERE class_id=? AND worker_id=?
                    """,state,processed,"DONE".equals(state)?null:"REVIEW_INCOMPLETE",classId,workerId);
            });
        }catch(Exception failed){
            try{db.update("""
                UPDATE post_lesson_skill_review_jobs SET state='FAILED',
                    failure_code='REVIEW_INTERRUPTED',lease_until=NULL,worker_id=NULL,
                    updated_at=now(),finished_at=now()
                WHERE class_id=? AND worker_id=?
                """,classId,workerId);}catch(Exception ignored){}
            LOG.warn("Skill review interrupted class={} type={}",classId,failed.getClass().getSimpleName());
        }
    }

    private boolean renew(UUID classId){
        return db.update("""
            UPDATE post_lesson_skill_review_jobs
            SET lease_until=now()+interval '15 minutes',updated_at=now()
            WHERE class_id=? AND worker_id=? AND state='RUNNING'
            """,classId,workerId)==1;
    }
    private boolean owns(UUID classId) {
        Integer found=db.queryForObject("""
            SELECT COUNT(*) FROM post_lesson_skill_review_jobs
            WHERE class_id=? AND worker_id=? AND state='RUNNING'
            """,Integer.class,classId,workerId);
        return found!=null && found==1;
    }
    private boolean alreadyDone(UUID classId,UUID studentId){
        Integer found=db.queryForObject("""
            SELECT COUNT(*) FROM post_lesson_skill_review_students
            WHERE class_id=? AND student_id=? AND state<>'ERROR'
            """,Integer.class,classId,studentId);
        return found!=null && found>0;
    }

    private PupilWork load(Job job,UUID studentId){
        OnlineClass room=classes.findById(job.classId()).orElseThrow();
        User teacher=users.findById(job.teacherId()).orElseThrow();
        User pupil=users.findById(studentId).orElseThrow();
        if(room.getStatus()!=OnlineClassStatus.ENDED || !room.getTeacher().getId().equals(teacher.getId())
                ||!room.getEventId().equals(job.eventId())
                ||teacher.isArchived()||teacher.getStatus()!=UserStatus.ACTIVE||teacher.getRole()!=Role.TEACHER
                ||pupil.isArchived()||pupil.getRole()!=Role.STUDENT||pupil.getStatus()!=UserStatus.ACTIVE
                ||pupil.getTeacher()==null||!pupil.getTeacher().getId().equals(teacher.getId()))
            throw new IllegalStateException("SKILL_REVIEW_OWNERSHIP");

        Instant observed=room.getActualEndAt()==null?Instant.now():room.getActualEndAt();
        Integer grade=pupil.getGrade();
        if(grade==null)return new PupilWork(null,List.of(),List.of(),"","",Set.of(),observed,"NO_BOARD");
        List<SkillBoardService.BoardSummary> candidates=boards.list().stream()
                .filter(board->board.grade()==grade).toList();
        if(candidates.size()!=1)return new PupilWork(null,List.of(),List.of(),"","",Set.of(),observed,"NO_BOARD");
        String boardId=candidates.get(0).id();
        List<SkillBoardService.Node> skills=boards.get(boardId).data().nodes().stream()
                .filter(node->"skill".equals(node.kind())&&!node.archived()
                        &&(node.schoolTypes()==null||node.schoolTypes().isEmpty()
                        ||(pupil.getSchoolType()!=null&&node.schoolTypes().contains(pupil.getSchoolType()))))
                .limit(160).toList();
        if(skills.isEmpty())return new PupilWork(boardId,skills,List.of(),"","",Set.of(),observed,"NO_BOARD");

        String personal=PersonalBoard.targetIdFor(studentId);
        String workbook=PersonalBoard.workbookTargetIdFor(studentId);
        var pdfs=new ArrayList<PostLessonSkillReviewAiService.SourcePdf>();
        db.query("""
            SELECT board_id,pdf FROM completed_lesson_documents
            WHERE class_id=? AND event_id=? AND teacher_id=? AND board_id IN (?,?)
            ORDER BY updated_at DESC
            """,rs->{
                byte[] bytes=rs.getBytes("pdf");
                if(bytes!=null && bytes.length<8_000_000) {
                    String name=workbook.equals(rs.getString("board_id"))?"workbook.pdf":"board.pdf";
                    pdfs.add(new PostLessonSkillReviewAiService.SourcePdf(name,bytes));
                }
            },job.classId(),job.eventId(),job.teacherId(),personal,workbook);
        // Prefer the workbook and reject oversized aggregate attachment sets.
        pdfs.sort(Comparator.comparing(p->p.name().equals("workbook.pdf")?0:1));
        if(pdfs.stream().mapToInt(p->p.bytes().length).sum()>10_000_000)pdfs.subList(1,pdfs.size()).clear();
        List<String> pupilSpeech=db.query("""
            SELECT text FROM online_class_transcript_segments
            WHERE class_id=? AND user_id=? ORDER BY start_ms,id
            """,(rs,i)->rs.getString(1),job.classId(),studentId);
        List<String> teacherSpeech=db.query("""
            SELECT text FROM online_class_transcript_segments
            WHERE class_id=? AND user_id=? ORDER BY start_ms,id
            """,(rs,i)->rs.getString(1),job.classId(),job.teacherId());
        Set<String> authored=new HashSet<>();
        db.query("""
            SELECT DISTINCT d.target_id,d.page_index
            FROM online_class_annotation_documents d
            JOIN online_class_annotation_events e ON e.document_id=d.id
            WHERE d.class_id=? AND d.target_type='WHITEBOARD'
              AND d.target_id IN (?,?) AND e.actor_id=?
              AND e.operation_type IN ('ADD','UPDATE') AND d.page_index>=0
            """,rs->{
                String name=workbook.equals(rs.getString(1))?"workbook.pdf":"board.pdf";
                authored.add(name+"#"+(rs.getInt(2)+1));
            },job.classId(),personal,workbook,studentId);
        String speech=PostLessonSkillReviewAiService.bounded(String.join("\n",pupilSpeech),8000);
        String teacherWords=PostLessonSkillReviewAiService.bounded(String.join("\n",teacherSpeech),6500);
        if(pdfs.isEmpty()&&speech.isBlank())
            return new PupilWork(boardId,skills,pdfs,speech,teacherWords,authored,observed,"NO_EVIDENCE");
        return new PupilWork(boardId,skills,List.copyOf(pdfs),speech,teacherWords,
                Set.copyOf(authored),observed,null);
    }

    private void commitPupil(Job job,UUID studentId,Outcome output){
        tx.executeWithoutResult(st->{
            if(!owns(job.classId()))throw new IllegalStateException("SKILL_REVIEW_LEASE_LOST");
            Integer existing=db.queryForObject("""
                SELECT COUNT(*) FROM post_lesson_skill_review_students
                WHERE class_id=? AND student_id=? AND state<>'ERROR'
                """,Integer.class,job.classId(),studentId);
            if(existing!=null&&existing>0)return;
            db.update("""
                DELETE FROM post_lesson_skill_review_students
                WHERE class_id=? AND student_id=? AND state='ERROR'
                """,job.classId(),studentId);
            int saved=0,updates=0;
            if("RECORDED".equals(output.state()) && output.boardId()!=null){
                User teacher=users.findById(job.teacherId()).orElseThrow();
                AuthenticatedUser actor=new AuthenticatedUser(teacher.getId(),teacher.getEmail(),teacher.getRole());
                Map<String,Integer> current=mastery.get(output.boardId(),studentId,actor).mastery();
                for(var finding:output.findings()) {
                    String location=finding.sourceDocument()+"#"+finding.pageNumber();
                    // A PDF page without this pupil's own drawing proves only what
                    // a teacher prepared, not pupil competence. Speech is accepted
                    // only if it was attributed to the pupil by the provider.
                    boolean authored=finding.pageNumber()==0 || output.pupilInkLocations().contains(location);
                    if(!authored)continue;
                    Integer after=masteryAfter(current.get(finding.skillId()),finding,
                            output.pupilInkLocations().contains(location));
                    String ref="online-class:"+job.classId()+":"+
                            (finding.pageNumber()==0?"speech":location);
                    var observation=new SkillEvidenceService.Observation(
                            finding.skillId(),"LESSON",ref,finding.autonomy(),
                            finding.explanation(),finding.sourceExcerpt().isBlank()?null:finding.sourceExcerpt(),
                            output.observedAt(),after,null,null,
                            "skillreview:"+job.classId()+":"+finding.skillId());
                    var receipt=evidence.record(output.boardId(),studentId,observation,actor);
                    saved++;
                    if(after!=null&&!receipt.replayed())updates++;
                }
            }
            String state="RECORDED".equals(output.state())&&saved==0?"NO_EVIDENCE":output.state();
            db.update("""
                INSERT INTO post_lesson_skill_review_students
                    (class_id,student_id,board_id,state,observations,mastery_updates,detail)
                VALUES (?,?,?,?,?,?,?)
                """,job.classId(),studentId,output.boardId(),state,saved,updates,output.detail());
            db.update("""
                UPDATE post_lesson_skill_review_jobs
                SET processed_students=(SELECT COUNT(*) FROM post_lesson_skill_review_students
                    WHERE class_id=?),updated_at=now()
                WHERE class_id=? AND worker_id=?
                """,job.classId(),job.classId(),workerId);
        });
    }

    /**
     * High bar: independently authored and correctly solved 2+ exercises.
     * No guesses from transcript-only or teacher-written PDF. One lesson cannot
     * inflate mastery above 85%; full proficiency requires corroborating tests.
     * Never lower an existing score from a single ambiguous observation.
     */
    static Integer masteryAfter(Integer previous,PostLessonSkillReviewAiService.Finding finding,
                                boolean studentAuthoredInk){
        if(!studentAuthoredInk||finding.confidence()<0.95
                ||!Set.of("FIRST_TRY","INDEPENDENT").contains(finding.autonomy())
                ||finding.attempted()<2||finding.correct()!=finding.attempted()
                ||finding.pageNumber()<1)return null;
        if(previous==null)return 55;
        if(previous>=85)return null;
        int updated=Math.min(85,previous+8);
        return updated>previous?updated:null;
    }

    @PreDestroy public void shutdown(){executor.shutdownNow();}
}