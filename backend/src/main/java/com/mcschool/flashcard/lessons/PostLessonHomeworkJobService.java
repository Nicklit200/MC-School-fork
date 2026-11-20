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
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{
        Thread t=new Thread(r,"mindcrafti-post-lesson-homework");t.setDaemon(true);return t;
    });
    private final AtomicBoolean busy=new AtomicBoolean(false);
    private final UUID workerId=UUID.randomUUID();
    private volatile UUID activeJob;

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

    public record Request(int days,String teacherInstructions) {}
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
            List<Map<String,Object>> roster=snapshotRoster(teacher,lesson);
            if(roster.isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT,"No active pupils in this lesson");
            LocalDate first=LocalDate.now(ZONE).plusDays(1);
            List<Job> existing=db.query("SELECT * FROM post_lesson_homework_jobs WHERE class_id=? FOR UPDATE",
                    this::row,classId);
            if(!existing.isEmpty()){
                Job job=existing.get(0);
                if(job.days()!=request.days()||!job.instructions().equals(notes))
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

    private List<Map<String,Object>> snapshotRoster(AuthenticatedUser teacher,OnlineClass lesson){
        List<User> students;
        if(lesson.getGroup()!=null){
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
        if(worker.isShutdown())return;
        UUID active=activeJob;
        if(active!=null){
            db.update("UPDATE post_lesson_homework_jobs SET lease_until=now()+INTERVAL '90 seconds' WHERE id=? AND state='RUNNING' AND worker_id=?",active,workerId);
        }
        if(!busy.compareAndSet(false,true))return;
        try{
            Job job=tx.execute(st->{
                db.update("UPDATE post_lesson_homework_jobs SET state='FAILED',failure_code='INTERRUPTED',finished_at=now(),updated_at=now() WHERE state='RUNNING' AND lease_until<now()");
                // Never process any pending teacher job outside the private pilot.
                List<Job> list=db.query("SELECT * FROM post_lesson_homework_jobs WHERE state='QUEUED' AND teacher_id=? ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",this::row,pilot.teacherId());
                if(list.isEmpty())return null;
                Job item=list.get(0);
                db.update("UPDATE post_lesson_homework_jobs SET state='RUNNING',worker_id=?,lease_until=now()+INTERVAL '90 seconds',updated_at=now() WHERE id=?",workerId,item.id());
                return item;
            });
            if(job==null){busy.set(false);return;}
            activeJob=job.id();
            worker.execute(()->{
                try{process(job);}
                catch(Exception failure){
                    recordFailure(job.id(),failure);
                } finally{activeJob=null;busy.set(false);}
            });
        }catch(Exception failure){activeJob=null;busy.set(false);LOG.warn("Post-lesson homework queue error type={} origin={}",failure.getClass().getSimpleName(),PostLessonHomeworkFailure.origin(failure));}
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
        for(Map<String,Object> pupil:eligible){
            UUID id=UUID.fromString(String.valueOf(pupil.get("id")));
            String name=String.valueOf(pupil.get("name"));
            for(int day=1;day<=job.days();day++){
                if(draftExists(job.id(),id,day))continue;
                final int currentDay=day;
                progress(job,PostLessonHomeworkStage.LESSON_EVIDENCE,currentDay);
                Map<String,Object> evidence=tx.execute(st->studentEvidence(teacher,job,id,currentDay,individual.getOrDefault(id,"")));
                OwnerWorkbookPdfRenderService.StudioRender pair=generator.make(evidence,day,job.days(),name,
                        stage->progress(job,stage,currentDay));
                progress(job,PostLessonHomeworkStage.PDF_STORAGE,currentDay);
                UUID draft=UUID.randomUUID();
                LocalDate date=job.startDate().plusDays(day-1);
                tx.executeWithoutResult(st->{
                    if(publishedOrRequireOwnership(job.id()))throw new IllegalStateException("HOMEWORK_JOB_LEASE_LOST");
                    db.update("INSERT INTO post_lesson_homework_drafts (id,job_id,student_id,day_number,assignment_date,student_pdf,teacher_pdf) VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id,student_id,day_number) DO NOTHING",
                            draft,job.id(),id,currentDay,date,pair.studentPdf(),pair.teacherPdf());
                    int count=db.queryForObject("SELECT count(*) FROM post_lesson_homework_drafts WHERE job_id=?",Integer.class,job.id());
                    db.update("UPDATE post_lesson_homework_jobs SET generated_files=?,updated_at=now() WHERE id=?",count,job.id());
                });
            }
        }
        progress(job,PostLessonHomeworkStage.PUBLICATION,null);
        publish(job,teacher,eligible);
        safeNotify(job.id());
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
            if(transcript.length()>24000)transcript=transcript.substring(transcript.length()-24000);
            data.put("transcript",transcript);
        });
        // Only THIS pupil's saved board plus the shared board; other pupils' writing stays private.
        List<String> boardText=new ArrayList<>();
        db.query("SELECT board_id,pdf FROM completed_lesson_documents WHERE class_id=? AND teacher_id=? ORDER BY updated_at DESC",rs->{
            String board=rs.getString("board_id");
            boolean permitted="board-1".equals(board)
                    ||PersonalBoard.ownerOf(board).map(studentId::equals).orElse(false);
            if(!permitted)return;
            byte[] bytes=rs.getBytes("pdf");
            if(bytes==null||bytes.length>5_000_000)return;
            try(var document=org.apache.pdfbox.Loader.loadPDF(bytes)){
                String extracted=new org.apache.pdfbox.text.PDFTextStripper().getText(document);
                if(extracted!=null&&!extracted.isBlank()){
                    String safe=extracted.length()>10000?extracted.substring(0,10000):extracted;
                    boardText.add(board+": "+safe);
                }
            }catch(Exception ignored){ /* Handwriting-heavy boards may have no extractable text. */ }
        },job.classId(),teacher.id());
        data.put("savedBoardText",String.join("\\n",boardText));
        List<String> live=transcriptSegments.findAllByOnlineClassIdOrderByStartMsAscIdAsc(job.classId()).stream()
                .map(s->s.getText()).filter(s->s!=null&&!s.isBlank()).toList();
        if(!live.isEmpty()){
            String joined=String.join("\n",live);
            data.put("liveTranscript",joined.length()>24000?joined.substring(joined.length()-24000):joined);
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
                if(source.getGroup()!=null && !members.existsByGroupIdAndStudentId(source.getGroup().getId(),id))
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
    @PreDestroy public void stop(){worker.shutdownNow();}
}
