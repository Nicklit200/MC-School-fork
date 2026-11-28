package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.homeworks.Homework;
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
import jakarta.annotation.PreDestroy;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Durable, idempotent, teacher-authorized generation and publication after an ENDED lesson. */
@Service
public class PostLessonHomeworkJobService {
    private static final Logger LOG=LoggerFactory.getLogger(PostLessonHomeworkJobService.class);
    private static final ZoneId ZONE=ZoneId.of("Europe/Berlin");
    private static final int MAX_SOURCE_WORKBOOK_PDF_BYTES=8_000_000;
    private static final int MAX_SOURCE_WORKBOOK_TEXT_CHARS=16_000;
    private static final int MAX_LESSON_TRANSCRIPT_CHARS=48_000;
    private static final int MAX_COMPLETED_BOARD_PDF_BYTES=3_000_000;
    private static final int MAX_TOTAL_BOARD_ATTACHMENT_BYTES=8_000_000;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final OnlineClassAccessService access;
    private final StudentGroupMemberRepository members;
    private final UserRepository users;
    private final HomeworkRepository homeworks;
    private final HomeworkPdfService homeworkPdf;
    private final LessonPreparationRepository preparations;
    private final LessonPreparationService lessonPreparation;
    private final OnlineClassTranscriptSegmentRepository transcriptSegments;
    private final MonthlyPlanService monthlyPlans;
    private final SchoolPromptSettingsService prompts;
    private final PostLessonHomeworkContentService generator;
    private final PostLessonHomeworkPushService jobPush;
    private final PostLessonHomeworkPilotAccess pilot;
    @org.springframework.beans.factory.annotation.Autowired
    private LessonParticipantsService lessonParticipants;
    // At most two active groups, up to four pupils each. The content service
    // independently limits provider requests to four and PDF renders to three.
    static final int MAX_PARALLEL_JOBS=2;
    static final int MAX_PUPILS_PER_JOB=4;
    private final ExecutorService pupilWorkers=Executors.newFixedThreadPool(MAX_PARALLEL_JOBS*MAX_PUPILS_PER_JOB,r->{
        Thread t=new Thread(r,"mindcrafti-homework-pupil");t.setDaemon(true);return t;
    });
    private final ExecutorService worker=Executors.newFixedThreadPool(MAX_PARALLEL_JOBS,r->{
        Thread t=new Thread(r,"mindcrafti-post-lesson-homework");t.setDaemon(true);return t;
    });
    private final AtomicBoolean ticking=new AtomicBoolean(false);
    private final UUID workerId=UUID.randomUUID();
    private final Set<UUID> activeJobs=ConcurrentHashMap.newKeySet();

    public PostLessonHomeworkJobService(JdbcTemplate db,PlatformTransactionManager manager,ObjectMapper json,
            OnlineClassAccessService access,StudentGroupMemberRepository members,UserRepository users,
            HomeworkRepository homeworks,HomeworkPdfService homeworkPdf,
            LessonPreparationRepository preparations,LessonPreparationService lessonPreparation,
            OnlineClassTranscriptSegmentRepository transcriptSegments,
            MonthlyPlanService monthlyPlans,SchoolPromptSettingsService prompts,
            PostLessonHomeworkContentService generator,
            PostLessonHomeworkPushService jobPush,
            PostLessonHomeworkPilotAccess pilot) {
        this.db=db;this.tx=new TransactionTemplate(manager);this.json=json;this.access=access;
        this.members=members;this.users=users;this.homeworks=homeworks;this.homeworkPdf=homeworkPdf;
        this.preparations=preparations;this.lessonPreparation=lessonPreparation;
        this.transcriptSegments=transcriptSegments;
        this.monthlyPlans=monthlyPlans;this.prompts=prompts;this.generator=generator;
        this.jobPush=jobPush;this.pilot=pilot;
    }

    public record Request(int days,String teacherInstructions,List<UUID> recipientStudentIds) {
        public Request(int days,String teacherInstructions){this(days,teacherInstructions,null);}
    }
    record Job(UUID id,UUID classId,UUID teacherId,String eventId,int days,LocalDate startDate,
            String instructions,String roster,String selection,String state,int generated,int expected,
            String failureCode,String stage,Integer dayNumber) {}

    public Map<String,Object> enqueue(AuthenticatedUser teacher,UUID classId,Request request){
        pilot.require(teacher);
        if(request==null||request.days()<1||request.days()>7)
            throw new IllegalArgumentException("Choose 1..7 days");
        String notes=Objects.toString(request.teacherInstructions(),"").trim();
        if(notes.length()>3000)throw new IllegalArgumentException("Teacher instructions must be shorter than 3000 characters");
        if(!generator.configured())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Server homework generation is not configured");
        return tx.execute(status->{
            OnlineClass lesson=access.requireHost(teacher,classId);
            if(lesson.getStatus()!=OnlineClassStatus.ENDED)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Finish the online lesson first");
            List<Map<String,Object>> allStudents=snapshotRoster(teacher,lesson);
            if(allStudents.isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT,"No active pupils in this lesson");
            List<Map<String,Object>> roster=selectRecipients(allStudents,request.recipientStudentIds());
            LocalDate first=LocalDate.now(ZONE).plusDays(1);
            List<Job> existing=db.query("SELECT * FROM post_lesson_homework_jobs WHERE class_id=? FOR UPDATE",
                    this::row,classId);
            if(!existing.isEmpty()){
                Job job=existing.get(0);
                if(job.days()!=request.days()||!job.instructions().equals(notes)
                        || !job.roster().equals(json.writeValueAsString(roster)))
                    throw new ResponseStatusException(HttpStatus.CONFLICT,"Homework already requested for this lesson; review its status");
                return response(job);
            }
            UUID id=UUID.randomUUID();
            db.update("INSERT INTO post_lesson_homework_jobs (id,class_id,teacher_id,event_id,lesson_title,days,start_date,teacher_instructions,roster_json) VALUES (?,?,?,?,?,?,?,?,?)",
                    id,classId,teacher.id(),lesson.getEventId(),lesson.getTitle(),request.days(),
                    first,notes,json.writeValueAsString(roster));
            return response(find(id));
        });
    }

    /** The status endpoint is intentionally teacher-scoped; it exposes no raw pupil records or notes. */
    public Map<String,Object> status(AuthenticatedUser teacher,UUID classId){
        pilot.require(teacher);
        access.requireHost(teacher,classId);
        List<Job> found=db.query("SELECT * FROM post_lesson_homework_jobs WHERE class_id=? AND teacher_id=?",
                this::row,classId,teacher.id());
        return found.isEmpty()?Map.of("state","NONE"):response(found.get(0));
    }

    public Map<String,Object> retry(AuthenticatedUser teacher,UUID classId){
        pilot.require(teacher);
        return tx.execute(st->{
            access.requireHost(teacher,classId);
            List<Job> found=db.query("SELECT * FROM post_lesson_homework_jobs WHERE class_id=? AND teacher_id=? FOR UPDATE",
                    this::row,classId,teacher.id());
            if(found.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Homework generation not found");
            Job job=found.get(0);
            if(!"FAILED".equals(job.state()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Only failed homework generation can be retried");
            if(!generator.configured())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"AI is not configured");
            db.update("UPDATE post_lesson_homework_jobs SET state='QUEUED',failure_code=NULL,generation_stage=NULL,day_number=NULL,worker_id=NULL,lease_until=NULL,finished_at=NULL,updated_at=now() WHERE id=?",job.id());
            return response(find(job.id()));
        });
    }

    /** Display authoritative students before submission; the browser cannot supply an arbitrary recipient. */
    public List<Map<String,Object>> recipients(AuthenticatedUser teacher,UUID classId){
        pilot.require(teacher);
        OnlineClass lesson=access.requireHost(teacher,classId);
        return snapshotRoster(teacher,lesson);
    }

    private static List<Map<String,Object>> selectRecipients(List<Map<String,Object>> available,List<UUID> selected){
        if(selected==null)return available;
        if(selected.isEmpty()||selected.size()!=new HashSet<>(selected).size())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Select at least one unique recipient");
        Set<String> ids=selected.stream().map(UUID::toString).collect(java.util.stream.Collectors.toSet());
        List<Map<String,Object>> result=available.stream()
                .filter(item->ids.contains(String.valueOf(item.get("id")))).toList();
        if(result.size()!=ids.size())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Recipients must be current students of this lesson");
        return result;
    }

    private List<Map<String,Object>> snapshotRoster(AuthenticatedUser teacher,OnlineClass lesson){
        List<User> students;
        if(lessonParticipants!=null && lessonParticipants.hasLesson(teacher.id(),lesson.getEventId())){
            students=lessonParticipants.students(teacher.id(),lesson.getEventId());
        } else if(lesson.getGroup()!=null){
            students=members.findAllByGroupIdOrderByStudentFullNameAsc(lesson.getGroup().getId()).stream()
                    .map(m->m.getStudent()).toList();
        } else if(lesson.getStudent()!=null){
            students=List.of(lesson.getStudent());
        } else return List.of();
        List<Map<String,Object>> result=new ArrayList<>();
        for(User s:students){
            if(s.getRole()!=Role.STUDENT||s.getStatus()!=UserStatus.ACTIVE||s.isArchived()
                    ||s.getTeacher()==null||!s.getTeacher().getId().equals(teacher.id()))continue;
            result.add(Map.of("id",s.getId().toString(),"name",s.getFullName()));
        }
        if(result.size()>25)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Too many students");
        return result;
    }

    @Scheduled(fixedDelay=2500,initialDelay=5000)
    public void tick(){
        if(worker.isShutdown()||!ticking.compareAndSet(false,true))return;
        try{
            for(UUID active:activeJobs)
                db.update("UPDATE post_lesson_homework_jobs SET lease_until=now()+INTERVAL '90 seconds' WHERE id=? AND state='RUNNING' AND worker_id=?",active,workerId);
            while(!worker.isShutdown()&&activeJobs.size()<MAX_PARALLEL_JOBS){
                Job job=tx.execute(st->{
                    // Serialize claims across overlapping deployments; a fresh
                    // statement after the lock sees all committed earlier claims.
                    db.queryForList("SELECT pg_advisory_xact_lock(hashtext(?))","post-homework-queue-claim");
                    // Recover a lost worker once; persisted daily plans and PDFs survive.
                    db.update("UPDATE post_lesson_homework_jobs SET state='QUEUED',worker_id=NULL,lease_until=NULL,interruption_retries=interruption_retries+1,updated_at=now() WHERE state='RUNNING' AND lease_until<now() AND interruption_retries<1");
                    db.update("UPDATE post_lesson_homework_jobs SET state='FAILED',failure_code='INTERRUPTED',finished_at=now(),worker_id=NULL,lease_until=NULL,updated_at=now() WHERE state='RUNNING' AND lease_until<now()");
                    Integer running=db.queryForObject("SELECT count(*) FROM post_lesson_homework_jobs WHERE state='RUNNING'",Integer.class);
                    if(running!=null&&running>=MAX_PARALLEL_JOBS)return null;
                    // All jobs are class-scoped; publication locks individual pupil/day pairs.
                    String query="SELECT q.* FROM post_lesson_homework_jobs q WHERE q.state='QUEUED' ";
                    List<Job> list=pilot.allTeachersEnabled()
                            ? db.query(query+"ORDER BY q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT 1",this::row)
                            : db.query(query+"AND q.teacher_id=? ORDER BY q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT 1",this::row,pilot.teacherId());
                    if(list.isEmpty())return null;
                    Job item=list.get(0);
                    db.update("UPDATE post_lesson_homework_jobs SET state='RUNNING',worker_id=?,lease_until=now()+INTERVAL '90 seconds',updated_at=now() WHERE id=?",workerId,item.id());
                    return item;
                });
                if(job==null)break;
                activeJobs.add(job.id());
                try{
                    worker.execute(()->{
                        try{process(job);}
                        catch(Exception failure){recordFailure(job.id(),failure);}
                        finally{activeJobs.remove(job.id());}
                    });
                    LOG.info("Post-lesson homework worker started job={} active={} max={}",job.id(),activeJobs.size(),MAX_PARALLEL_JOBS);
                }catch(RejectedExecutionException stopped){
                    activeJobs.remove(job.id());
                    recordFailure(job.id(),new IllegalStateException("HOMEWORK_JOB_LEASE_LOST",stopped));
                    break;
                }
            }
        }catch(Exception failure){
            LOG.warn("Post-lesson homework queue error type={} origin={}",failure.getClass().getSimpleName(),PostLessonHomeworkFailure.origin(failure));
        }finally{ticking.set(false);}
    }

    private void recordFailure(UUID jobId,Exception failure){
        String code=PostLessonHomeworkFailure.code(failure);
        // A worker from an expired lease must not fail a newer retry or a published job.
        try {
            int changed=db.update("UPDATE post_lesson_homework_jobs SET state='FAILED',failure_code=?,worker_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now() WHERE id=? AND state='RUNNING' AND worker_id=?",code,jobId,workerId);
            if(changed>0) safeNotify(jobId);
        } catch (RuntimeException persistenceFailure) {
            // Preserve the original safe diagnosis even when the database is unavailable.
            LOG.warn("Post-lesson homework failure persistence job={} type={} origin={}",jobId,
                    persistenceFailure.getClass().getSimpleName(),PostLessonHomeworkFailure.origin(persistenceFailure));
        }
        LOG.warn("Post-lesson homework job={} failed code={} type={} origin={}",jobId,code,
                failure.getClass().getSimpleName(),PostLessonHomeworkFailure.origin(failure));
    }

    private void progress(Job job,PostLessonHomeworkStage stage,Integer day){
        int changed=db.update("UPDATE post_lesson_homework_jobs SET generation_stage=?,day_number=?,updated_at=now() WHERE id=? AND state='RUNNING' AND worker_id=?",
                stage.name(),day,job.id(),workerId);
        if(changed!=1)throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
        LOG.info("Post-lesson homework progress job={} stage={} day={}",job.id(),stage,day);
    }

    @SuppressWarnings("unchecked")
    private void process(Job original)throws Exception{
        Job job=find(original.id());
        pilot.require(job.teacherId());
        if(!users.existsByIdAndRoleAndStatusAndArchivedFalse(job.teacherId(),Role.TEACHER,UserStatus.ACTIVE))
            throw new IllegalStateException("HOMEWORK_TEACHER_REVOKED");
        AuthenticatedUser teacher=new AuthenticatedUser(job.teacherId(),null,Role.TEACHER);
        progress(job,PostLessonHomeworkStage.RECIPIENT_SELECTION,null);
        List<Map<String,Object>> roster=json.readValue(job.roster(),List.class);
        Map<String,Object> selection;
        if(job.selection()==null){
            selection=generator.select(roster,job.instructions());
            String saved=json.writeValueAsString(selection);
            int changed=db.update("UPDATE post_lesson_homework_jobs SET selection_json=?,updated_at=now() WHERE id=? AND selection_json IS NULL AND state='RUNNING' AND worker_id=?",saved,job.id(),workerId);
            if(changed!=1)throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
        } else selection=json.readValue(job.selection(),Map.class);
        // Older jobs may contain invalid AI exclusions. Verify them again on every retry.
        selection=PostLessonHomeworkRecipientGuard.verify(roster,job.instructions(),selection);
        Set<UUID> excluded=new HashSet<>();
        for(Object raw:(List<?>)selection.get("excluded")){
            Map<?,?> data=(Map<?,?>)raw;excluded.add(UUID.fromString(String.valueOf(data.get("studentId"))));
        }
        Map<UUID,String> individual=new HashMap<>();
        for(Object raw:(List<?>)selection.get("personalNotes")){
            Map<?,?> data=(Map<?,?>)raw;
            individual.merge(UUID.fromString(String.valueOf(data.get("studentId"))),
                    String.valueOf(data.get("note")),(a,b)->a+"\n"+b);
        }
        List<Map<String,Object>> eligible=roster.stream()
                .filter(s->!excluded.contains(UUID.fromString(String.valueOf(s.get("id"))))).toList();
        if(eligible.isEmpty())throw new IllegalStateException("HOMEWORK_NO_RECIPIENTS");
        int changed=db.update("UPDATE post_lesson_homework_jobs SET expected_files=?,updated_at=now() WHERE id=? AND state='RUNNING' AND worker_id=?",
                eligible.size()*job.days(),job.id(),workerId);
        if(changed!=1)throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
        // Process all four pupils of a group concurrently. Join every submitted
        // task even if a sibling fails so no task can write after job failure.
        Exception firstFailure=null;
        for(int offset=0;offset<eligible.size();offset+=MAX_PUPILS_PER_JOB){
            List<Future<Void>> batch=new ArrayList<>();
            for(Map<String,Object> pupil:eligible.subList(offset,Math.min(eligible.size(),offset+MAX_PUPILS_PER_JOB))){
                UUID id=UUID.fromString(String.valueOf(pupil.get("id")));
                String name=String.valueOf(pupil.get("name")),note=individual.getOrDefault(id,"");
                batch.add(pupilWorkers.submit(()->{processPupil(job,teacher,id,name,note);return null;}));
            }
            for(Future<Void> task:batch){
                try{task.get();}
                catch(ExecutionException e){
                    Throwable cause=e.getCause();
                    if(firstFailure==null)firstFailure=cause instanceof Exception ex?ex:new IllegalStateException("HOMEWORK_PUPIL_FAILED",cause);
                }
                catch(InterruptedException e){
                    batch.forEach(f->f.cancel(true));Thread.currentThread().interrupt();throw e;
                }
            }
        }
        if(firstFailure!=null)throw firstFailure;
        progress(job,PostLessonHomeworkStage.PUBLICATION,null);
        publish(job,teacher,eligible);
        safeNotify(job.id());
    }

    @SuppressWarnings("unchecked")
    private void processPupil(Job job,AuthenticatedUser teacher,UUID id,String name,String note)throws Exception{
        List<Integer> missing=new ArrayList<>();
        for(int day=1;day<=job.days();day++)if(!draftExists(job.id(),id,day))missing.add(day);
        if(missing.isEmpty())return;
        Map<Integer,Map<String,Object>> plans=new HashMap<>();
        for(Map<String,Object> row:db.queryForList(
                "SELECT day_number,plan_json FROM post_lesson_homework_task_plans WHERE job_id=? AND student_id=?",job.id(),id)){
            plans.put(((Number)row.get("day_number")).intValue(),json.readValue((String)row.get("plan_json"),Map.class));
        }
        List<Integer> unplanned=missing.stream().filter(day->!plans.containsKey(day)).toList();
        if(!unplanned.isEmpty()){
            progress(job,PostLessonHomeworkStage.LESSON_EVIDENCE,unplanned.get(0));
            Map<String,Object> evidence=tx.execute(st->studentEvidence(teacher,job,id,unplanned.get(0),note));
            List<Map<String,Object>> history=new ArrayList<>(priorGeneratedHomework(job.id(),id));
            // Reserve the exercises in already prepared, not-yet-rendered days too.
            for(int day:missing)if(plans.containsKey(day)){
                Map<String,Object> primary=(Map<String,Object>)plans.get(day).get("primary");
                Map<String,Object> review=(Map<String,Object>)primary.get("review");
                history.add(Map.of("day",day,"tasks",review.get("tasks")));
            }
            evidence.put("previousGeneratedHomework",history);
            List<Map<String,Object>> generated=generator.prepareTaskSeries(evidence,unplanned,job.days(),name,
                    stage->progress(job,stage,unplanned.get(0)));
            tx.executeWithoutResult(st->{
                if(publishedOrRequireOwnership(job.id()))throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
                for(Map<String,Object> plan:generated){
                    int day=((Number)plan.get("day")).intValue();
                    db.update("INSERT INTO post_lesson_homework_task_plans(job_id,student_id,day_number,plan_json) VALUES (?,?,?,?) ON CONFLICT(job_id,student_id,day_number) DO NOTHING",
                            job.id(),id,day,json.writeValueAsString(plan));
                    plans.put(day,plan);
                }
            });
            LOG.info("Homework pupil plan saved job={} days={}",job.id(),generated.size());
        }
        for(int currentDay:missing){
            Map<String,Object> plan=plans.get(currentDay);
            if(plan==null)throw new IllegalStateException("HOMEWORK_DRAFT_VALIDATION_FAILED");
            PostLessonHomeworkContentService.GeneratedHomework generated=generator.renderPreparedDay(plan,
                    stage->progress(job,stage,currentDay));
            OwnerWorkbookPdfRenderService.StudioRender pair=generated.pdf();
            progress(job,PostLessonHomeworkStage.PDF_STORAGE,currentDay);
            UUID draft=UUID.randomUUID();
            LocalDate date=job.startDate().plusDays(currentDay-1);
            tx.executeWithoutResult(st->{
                if(publishedOrRequireOwnership(job.id()))throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
                db.update("INSERT INTO post_lesson_homework_drafts (id,job_id,student_id,day_number,assignment_date,student_pdf,teacher_pdf,review_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(job_id,student_id,day_number) DO NOTHING",
                        draft,job.id(),id,currentDay,date,pair.studentPdf(),pair.teacherPdf(),json.writeValueAsString(generated.review()));
                int count=db.queryForObject("SELECT count(*) FROM post_lesson_homework_drafts WHERE job_id=?",Integer.class,job.id());
                db.update("UPDATE post_lesson_homework_jobs SET generated_files=?,updated_at=now() WHERE id=?",count,job.id());
            });
        }
    }

    /** Hold the job lock through the draft/publication transaction to fence an expired worker. */
    private boolean publishedOrRequireOwnership(UUID jobId){
        List<Map<String,Object>> locked=db.queryForList(
                "SELECT state,worker_id FROM post_lesson_homework_jobs WHERE id=? FOR UPDATE",jobId);
        if(locked.size()!=1)throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
        Map<String,Object> row=locked.get(0);
        if("PUBLISHED".equals(row.get("state")))return true;
        if(!"RUNNING".equals(row.get("state"))||!workerId.equals(row.get("worker_id")))
            throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
        return false;
    }

    /** Push failures are isolated from the committed homework and never change its state. */
    private void safeNotify(UUID jobId) {
        try { jobPush.captureTerminal(jobId); }
        catch (RuntimeException notificationError) {
            LOG.warn("Homework push capture failed job={} error={}",
                    jobId, notificationError.getClass().getSimpleName());
            // The independent push scheduler recovers terminal job events after a restart.
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String,Object>> priorGeneratedHomework(UUID jobId,UUID studentId) throws Exception {
        List<Map<String,Object>> previous=new ArrayList<>();
        for(Map<String,Object> row:db.queryForList("""
                SELECT day_number,review_json FROM post_lesson_homework_drafts
                 WHERE job_id=? AND student_id=? AND review_json IS NOT NULL
                 ORDER BY day_number
                """,jobId,studentId)) {
            Map<String,Object> review=json.readValue((String)row.get("review_json"),Map.class);
            if(review==null || !(review.get("tasks") instanceof List<?> tasks))
                throw new IllegalStateException("HOMEWORK_DIVERSITY_HISTORY_INVALID");
            List<Map<String,Object>> expressions=new ArrayList<>();
            for(Object raw:tasks) {
                if(!(raw instanceof Map<?,?> task)
                        || !(task.get("expression") instanceof String expression))
                    throw new IllegalStateException("HOMEWORK_DIVERSITY_HISTORY_INVALID");
                expressions.add(Map.of("expression",expression));
            }
            previous.add(Map.of("day",((Number)row.get("day_number")).intValue(),
                    "tasks",expressions));
        }
        return previous;
    }

    private boolean draftExists(UUID job,UUID student,int day){
        Integer count=db.queryForObject("SELECT count(*) FROM post_lesson_homework_drafts WHERE job_id=? AND student_id=? AND day_number=?",Integer.class,job,student,day);
        return count!=null&&count>0;
    }

    private Map<String,Object> studentEvidence(AuthenticatedUser teacher,Job job,UUID studentId,int day,String note){
        User student=users.findById(studentId).orElseThrow(()->new IllegalStateException("HOMEWORK_STUDENT_MISSING"));
        if(!users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(studentId,teacher.id(),Role.STUDENT,UserStatus.ACTIVE))
            throw new IllegalStateException("HOMEWORK_STUDENT_CHANGED");
        Map<String,Object> data=new LinkedHashMap<>();
        data.put("studentId",studentId.toString());data.put("studentName",student.getFullName());
        data.put("grade",student.getGrade());data.put("schoolType",student.getSchoolType());
        data.put("preferredLanguage",String.valueOf(student.getPreferredLanguage()));
        data.put("learningDifficulties",student.getLearningDifficulties());
        data.put("learningStrengths",student.getLearningStrengths());
        data.put("learningNotes",student.getLearningNotes());
        data.put("teacherNotes",job.instructions());data.put("personalTeacherNotes",note);
        data.put("homeworkPrompt",prompts.readForMcp().homeworkPrompt());
        data.put("dayNumber",day);data.put("totalDays",job.days());
        data.put("date",job.startDate().plusDays(day-1).toString());
        data.put("lessonTitle",job.eventId());
        preparations.findByTeacherIdAndEventId(teacher.id(),job.eventId()).ifPresent(p->{
            data.put("coveredMaterial",Objects.toString(p.getCoveredMaterial(),""));
            data.put("lessonPlan",Objects.toString(p.getLessonPlan(),""));
            data.put("lessonDifficulties",Objects.toString(p.getDifficulties(),""));
            data.put("lessonHomeworkNotes",Objects.toString(p.getHomeworkNotes(),""));
            String transcript=Objects.toString(lessonPreparation.transcriptTextForAnalysis(p),"");
            // Keep full ordinary lessons, not only their ending. A lost
            // early segment can be the teacher's explicit decision to skip
            // overly easy exercises. Mark longer transcripts as incomplete.
            if(transcript.length()>MAX_LESSON_TRANSCRIPT_CHARS) {
                data.put("transcriptTruncated",true);
                transcript=transcript.substring(0,4000)
                        +"\n[... middle of lesson transcript omitted due to size ...]\n"
                        +transcript.substring(transcript.length()-(MAX_LESSON_TRANSCRIPT_CHARS-4000));
            } else data.put("transcriptTruncated",false);
            data.put("transcript",transcript);
        });
        // Only THIS pupil's saved board plus the shared board; other pupils' writing stays private.
        List<String> boardText=new ArrayList<>();
        List<Map<String,Object>> completedBoardPdfs=new ArrayList<>();
        List<String> completedBoardSources=new ArrayList<>();
        int[] totalAttachedBytes={0};
        db.query("SELECT board_id,pdf FROM completed_lesson_documents WHERE class_id=? AND teacher_id=? ORDER BY updated_at DESC",rs->{
            String board=rs.getString("board_id");
            // Explicit class + teacher + exact student board ownership is
            // essential: never attach a different pupil's private pages.
            boolean permitted="board-1".equals(board)
                    ||PersonalBoard.ownerOf(board).map(studentId::equals).orElse(false);
            if(!permitted)return;
            byte[] bytes=rs.getBytes("pdf");
            if(bytes==null||bytes.length>5_000_000)return;
            try(var document=org.apache.pdfbox.Loader.loadPDF(bytes)){
                if(document.getNumberOfPages()<1||document.getNumberOfPages()>40)return;
                String extracted=new org.apache.pdfbox.text.PDFTextStripper().getText(document);
                if(extracted!=null&&!extracted.isBlank()){
                    String safe=extracted.length()>10000?extracted.substring(0,10000):extracted;
                    boardText.add(board+": "+safe);
                }
                // PDFBox text extraction cannot see handwritten strokes or
                // image-only pages. Attach the actual completed PDF to the
                // multimodal model along with the original lesson workbook.
                // Bound pages, count and total bytes before encoding.
                if(completedBoardPdfs.size()<3
                        &&bytes.length<=MAX_COMPLETED_BOARD_PDF_BYTES
                        &&totalAttachedBytes[0]+bytes.length<=MAX_TOTAL_BOARD_ATTACHMENT_BYTES){
                    String source="board-1".equals(board)?"shared"
                            :PersonalBoard.isWorkbook(board)?"personal-workbook":"personal";
                    completedBoardPdfs.add(Map.of("source",source,
                            "base64",Base64.getEncoder().encodeToString(bytes)));
                    completedBoardSources.add("completed_board_"+completedBoardPdfs.size()+".pdf: "+source);
                    totalAttachedBytes[0]+=bytes.length;
                }
            }catch(Exception ignored){ /* An unreadable board must not break transcription evidence. */ }
        },job.classId(),teacher.id());
        data.put("savedBoardText",String.join("\\n",boardText));
        if(!completedBoardPdfs.isEmpty()) {
            data.put("_completedBoardPdfFiles",completedBoardPdfs);
            data.put("completedBoardPdfSources",completedBoardSources);
        }
        List<String> live=transcriptSegments.findAllByOnlineClassIdOrderByStartMsAscIdAsc(job.classId()).stream()
                .map(s->s.getText()).filter(s->s!=null&&!s.isBlank()).toList();
        // Do not pay for the same transcription twice. The live transcript
        // remains a fallback if the archived lesson transcription is missing.
        if(!live.isEmpty() && Objects.toString(data.get("transcript"),"").isBlank()){
            String joined=String.join("\n",live);
            data.put("liveTranscript",joined.length()>MAX_LESSON_TRANSCRIPT_CHARS
                    ?joined.substring(joined.length()-MAX_LESSON_TRANSCRIPT_CHARS):joined);
        }
        var plan=monthlyPlans.get(teacher,"student",studentId,java.time.YearMonth.from(job.startDate()).toString());
        data.put("monthlyPlan",plan.planJson()==null?"":plan.planJson().substring(0,Math.min(14000,plan.planJson().length())));
        List<Map<String,Object>> previous=new ArrayList<>();
        for(Homework h:homeworks.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(studentId)){
            if(h.getStartDate().isBefore(job.startDate())&&previous.size()<12)
                previous.add(Map.of("date",h.getStartDate().toString(),"file",Objects.toString(h.getWorksheetFilename(),""),
                        "submitted",h.isSubmitted()));
        }
        data.put("previousHomework",previous);
        // The student's ORIGINAL attached lesson workbook is a source of example tasks,
        // not proof they were solved. Prefer their own PDF; use the shared PDF as fallback.
        WorksheetSource worksheet=lessonWorksheet(teacher.id(),job.eventId(),studentId);
        if(worksheet!=null){
            data.put("lessonWorksheetSource",worksheet.source());
            data.put("lessonWorksheetPages",worksheet.pages());
            data.put("lessonWorksheetText",worksheet.text());
            data.put("worksheetIsEvidenceOfCompletion",false);
            // The generative API receives this as a real PDF attachment, NOT base64 text.
            data.put("_lessonWorksheetPdfBase64",Base64.getEncoder().encodeToString(worksheet.pdf()));
        }
        // Without transcription, the workbook and teacher's written/voice instructions
        // are sufficient to ground new practice. Never invent student mistakes.
        boolean hasLesson=(!Objects.toString(data.get("transcript"),"").isBlank()
                ||!Objects.toString(data.get("liveTranscript"),"").isBlank()
                ||!Objects.toString(data.get("coveredMaterial"),"").isBlank()
                ||!Objects.toString(data.get("savedBoardText"),"").isBlank()
                ||!completedBoardPdfs.isEmpty()
                ||worksheet!=null);
        if(!hasLesson)throw new IllegalStateException("HOMEWORK_LESSON_EVIDENCE_MISSING");
        return data;
    }

    /** Student-visible PDF only. Teacher answers must never enter the AI evidence. */
    record WorksheetSource(byte[] pdf,String source,String text,int pages){}

    private WorksheetSource lessonWorksheet(UUID teacherId,String eventId,UUID studentId){
        List<byte[]> personal=db.query(
                "SELECT workbook_pdf FROM personal_lesson_workbooks WHERE teacher_id=? AND event_id=? AND student_id=?",
                (rs,i)->rs.getBytes(1),teacherId,eventId,studentId);
        if(!personal.isEmpty()){
            WorksheetSource source=inspectWorksheet(personal.get(0),"personal");
            if(source!=null)return source;
        }
        List<byte[]> shared=db.query(
                "SELECT workbook_pdf FROM lesson_preparations WHERE teacher_id=? AND event_id=? AND workbook_pdf IS NOT NULL",
                (rs,i)->rs.getBytes(1),teacherId,eventId);
        return shared.isEmpty()?null:inspectWorksheet(shared.get(0),"shared");
    }

    static WorksheetSource inspectWorksheet(byte[] bytes,String source){
        if(bytes==null||bytes.length<100||bytes.length>MAX_SOURCE_WORKBOOK_PDF_BYTES)return null;
        try(var document=org.apache.pdfbox.Loader.loadPDF(bytes)){
            int pages=document.getNumberOfPages();
            if(pages<1||pages>40)return null;
            var stripper=new org.apache.pdfbox.text.PDFTextStripper();
            stripper.setSortByPosition(true);
            String text=Objects.toString(stripper.getText(document),"").strip();
            if(text.length()>MAX_SOURCE_WORKBOOK_TEXT_CHARS)
                text=text.substring(0,MAX_SOURCE_WORKBOOK_TEXT_CHARS);
            return new WorksheetSource(bytes,source,text,pages);
        }catch(Exception failure){
            // Malformed legacy workbooks do not hide valid transcripts and board data.
            return null;
        }
    }

    /**
     * Publish one new homework record per generated PDF, atomically.
     * Multiple independent homeworks on the same calendar date are allowed
     * (V16 removed the old student/date uniqueness constraint).
     * The job's unique class_id and its persisted drafts protect retries;
     * existing homework rows and student submissions are never modified.
     */
    void publish(Job job,AuthenticatedUser teacher,List<Map<String,Object>> students){
        tx.executeWithoutResult(st->{
            if(publishedOrRequireOwnership(job.id()))return;
            User owner=users.findById(job.teacherId()).orElseThrow(()->new IllegalStateException("HOMEWORK_TEACHER_REVOKED"));
            if(owner.getRole()!=Role.TEACHER||owner.getStatus()!=UserStatus.ACTIVE||owner.isArchived())
                throw new IllegalStateException("HOMEWORK_TEACHER_REVOKED");
            OnlineClass source=access.requireHost(teacher,job.classId());
            if(source.getStatus()!=OnlineClassStatus.ENDED)
                throw new IllegalStateException("HOMEWORK_CLASS_CHANGED");
            List<Map<String,Object>> saved=db.queryForList(
                    "SELECT student_id,day_number,assignment_date,student_pdf FROM post_lesson_homework_drafts WHERE job_id=? ORDER BY student_id,day_number",job.id());
            if(saved.size()!=students.size()*job.days())
                throw new IllegalStateException("HOMEWORK_DRAFT_COUNT_MISMATCH");
            for(Map<String,Object> row:saved){
                UUID id=(UUID)row.get("student_id");
                LocalDate date=((java.sql.Date)row.get("assignment_date")).toLocalDate();
                // Serialize publication for this pupil/day. Distinct lessons on
                // the same day still create separate homeworks; never overwrite.
                db.queryForList("SELECT pg_advisory_xact_lock(hashtext(?))","post-homework:"+id+":"+date);
                if(!users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(id,teacher.id(),Role.STUDENT,UserStatus.ACTIVE))
                    throw new IllegalStateException("HOMEWORK_STUDENT_CHANGED");
                if(lessonParticipants != null && lessonParticipants.hasLesson(teacher.id(),job.eventId())) {
                    if(!lessonParticipants.includes(teacher.id(),job.eventId(),id))
                        throw new IllegalStateException("HOMEWORK_MEMBERSHIP_CHANGED");
                } else if(source.getGroup()!=null && !members.existsByGroupIdAndStudentId(source.getGroup().getId(),id))
                    throw new IllegalStateException("HOMEWORK_MEMBERSHIP_CHANGED");
                // An existing worksheet on this date is not a collision.
                // HomeworkPdfService.createWorksheetHomework creates a fresh UUID,
                // so it cannot replace or reset an earlier student's submission.
            }
            for(Map<String,Object> row:saved){
                UUID id=(UUID)row.get("student_id");
                LocalDate date=((java.sql.Date)row.get("assignment_date")).toLocalDate();
                int day=((Number)row.get("day_number")).intValue();
                byte[] bytes=(byte[])row.get("student_pdf");
                // A unique, recognizable filename also distinguishes two homework
                // PDFs on the same date in the teacher and student listings.
                String filename="Mindcrafti_Hausaufgabe_"+date+"_Tag_"+day+"_"+
                        job.id()+".pdf";
                homeworkPdf.createWorksheetHomework(teacher,id,date,
                        new PdfFile(filename,bytes));
            }
            int changed=db.update("UPDATE post_lesson_homework_jobs SET state='PUBLISHED',finished_at=now(),worker_id=NULL,lease_until=NULL,updated_at=now() WHERE id=? AND state='RUNNING' AND worker_id=?",job.id(),workerId);
            if(changed!=1)throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
        });
    }

    private Job find(UUID id){
        return db.query("SELECT * FROM post_lesson_homework_jobs WHERE id=?",this::row,id).stream()
                .findFirst().orElseThrow(()->new IllegalArgumentException("Homework job missing"));
    }
    private Job row(ResultSet rs,int index)throws SQLException{
        return new Job((UUID)rs.getObject("id"),(UUID)rs.getObject("class_id"),(UUID)rs.getObject("teacher_id"),
                rs.getString("event_id"),rs.getInt("days"),rs.getDate("start_date").toLocalDate(),
                rs.getString("teacher_instructions"),rs.getString("roster_json"),rs.getString("selection_json"),
                rs.getString("state"),rs.getInt("generated_files"),rs.getInt("expected_files"),
                rs.getString("failure_code"),rs.getString("generation_stage"),rs.getObject("day_number",Integer.class));
    }
    private Map<String,Object> response(Job job){
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("jobId",job.id().toString());result.put("classId",job.classId().toString());
        result.put("state",job.state());result.put("days",job.days());
        result.put("startDate",job.startDate().toString());
        result.put("generatedFiles",job.generated());result.put("expectedFiles",job.expected());
        result.put("failureCode",job.failureCode());
        result.put("stage",job.stage());
        result.put("dayNumber",job.dayNumber());
        return result;
    }

    record PdfFile(String filename,byte[] bytes) implements MultipartFile{
        public String getName(){return "file";}
        public String getOriginalFilename(){return filename;}
        public String getContentType(){return "application/pdf";}
        public boolean isEmpty(){return bytes.length==0;}
        public long getSize(){return bytes.length;}
        public byte[] getBytes(){return bytes.clone();}
        public InputStream getInputStream(){return new ByteArrayInputStream(bytes);}
        public void transferTo(File file)throws IOException{java.nio.file.Files.write(file.toPath(),bytes);}
    }
    @PreDestroy public void stop(){worker.shutdownNow();pupilWorkers.shutdownNow();}
}
