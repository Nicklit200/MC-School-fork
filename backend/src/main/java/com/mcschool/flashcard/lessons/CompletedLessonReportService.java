package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.Role;
import jakarta.annotation.PreDestroy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Persistent manual previews. The automatic skill/mastery writer is never called. */
@Service
public class CompletedLessonReportService {
    private static final Logger LOG=LoggerFactory.getLogger(CompletedLessonReportService.class);
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final PostLessonSkillReviewService review;
    private final UUID workerId=UUID.randomUUID();
    private final AtomicBoolean busy=new AtomicBoolean(false);
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{
        Thread t=new Thread(r,"completed-lesson-report");t.setDaemon(true);return t;
    });

    public record Request(UUID studentId,UUID requestId,String teacherInstructions) {}
    public record ReportJob(UUID id,String state,String createdAt,String finishedAt,String failureCode,
            PostLessonSkillReviewService.PreviewReport report) {}
    private record Pending(UUID id,UUID classId,UUID teacherId,UUID studentId,String focus) {}

    public CompletedLessonReportService(JdbcTemplate jdbc,ObjectMapper json,
            PlatformTransactionManager manager,PostLessonSkillReviewService review) {
        this.jdbc=jdbc;this.json=json;this.tx=new TransactionTemplate(manager);this.review=review;
    }

    public List<PostLessonSkillReviewService.ReportRecipient> recipients(AuthenticatedUser teacher,UUID classId) {
        return review.previewRecipients(teacher,classId);
    }

    private void authorize(AuthenticatedUser teacher,UUID classId,UUID studentId) {
        if(studentId==null || recipients(teacher,classId).stream().noneMatch(s->s.id().equals(studentId)))
            throw new ResourceNotFoundException("Lesson pupil not found");
    }

    public List<ReportJob> history(AuthenticatedUser teacher,UUID classId,UUID studentId) {
        authorize(teacher,classId,studentId);
        return jdbc.query("""
            SELECT id,state,created_at,finished_at,failure_code,result_json::text
            FROM completed_lesson_report_jobs WHERE class_id=? AND teacher_id=? AND student_id=?
            ORDER BY created_at DESC,id DESC LIMIT 10
            """,this::row,classId,teacher.id(),studentId);
    }

    public ReportJob enqueue(AuthenticatedUser teacher,UUID classId,Request request) {
        if(request==null || request.requestId()==null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Request ID required");
        authorize(teacher,classId,request.studentId());
        String focus=Objects.toString(request.teacherInstructions(),"").strip();
        if(focus.length()>3000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Teacher instructions too long");
        return tx.execute(st->{
            jdbc.update("""
                INSERT INTO completed_lesson_report_jobs(id,class_id,teacher_id,student_id,teacher_focus)
                VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING
                """,request.requestId(),classId,teacher.id(),request.studentId(),focus);
            List<ReportJob> exact=jdbc.query("""
                SELECT id,state,created_at,finished_at,failure_code,result_json::text
                FROM completed_lesson_report_jobs
                WHERE id=? AND class_id=? AND teacher_id=? AND student_id=? AND teacher_focus=?
                """,this::row,request.requestId(),classId,teacher.id(),request.studentId(),focus);
            if(!exact.isEmpty())return exact.get(0);
            // Same pupil / same prompt already running is safe to reuse. A different
            // prompt or pupil must not silently start another paid provider request.
            List<ReportJob> active=jdbc.query("""
                SELECT id,state,created_at,finished_at,failure_code,result_json::text
                FROM completed_lesson_report_jobs
                WHERE class_id=? AND teacher_id=? AND student_id=? AND teacher_focus=?
                  AND state IN ('QUEUED','RUNNING')
                """,this::row,classId,teacher.id(),request.studentId(),focus);
            if(!active.isEmpty())return active.get(0);
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Another report is running or request ID is already used");
        });
    }

    public PostLessonSkillReviewService.PreviewReport report(AuthenticatedUser teacher,UUID classId,
            UUID studentId,UUID id) {
        authorize(teacher,classId,studentId);
        List<ReportJob> rows=jdbc.query("""
            SELECT id,state,created_at,finished_at,failure_code,result_json::text
            FROM completed_lesson_report_jobs WHERE id=? AND class_id=? AND teacher_id=? AND student_id=?
            """,this::row,id,classId,teacher.id(),studentId);
        if(rows.isEmpty() || !"DONE".equals(rows.get(0).state()) || rows.get(0).report()==null)
            throw new ResourceNotFoundException("Report not found");
        return rows.get(0).report();
    }

    private ReportJob row(ResultSet rs,int i)throws SQLException {
        String raw=rs.getString(6);
        return new ReportJob(rs.getObject("id",UUID.class),rs.getString("state"),
                rs.getTimestamp("created_at").toInstant().toString(),
                rs.getTimestamp("finished_at")==null?null:rs.getTimestamp("finished_at").toInstant().toString(),
                rs.getString("failure_code"),raw==null?null:json.readValue(raw,PostLessonSkillReviewService.PreviewReport.class));
    }

    @Scheduled(fixedDelayString="${app.completed-lesson-report.poll-ms:3000}",initialDelayString="${app.completed-lesson-report.initial-ms:10000}")
    public void tick() {
        if(!busy.compareAndSet(false,true))return;
        try {
            Pending job=tx.execute(st->{
                // A process that died may already have charged a provider call.
                // Do not silently repeat it. A teacher can explicitly try again.
                jdbc.update("""
                    UPDATE completed_lesson_report_jobs SET state='FAILED',failure_code='WORKER_INTERRUPTED',
                      worker_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now()
                    WHERE state='RUNNING' AND lease_until<now()
                    """);
                return jdbc.query("""
                    UPDATE completed_lesson_report_jobs SET state='RUNNING',worker_id=?,
                      lease_until=now()+INTERVAL '5 minutes',updated_at=now()
                    WHERE id=(SELECT id FROM completed_lesson_report_jobs WHERE state='QUEUED'
                      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
                    RETURNING id,class_id,teacher_id,student_id,teacher_focus
                    """,(rs,i)->new Pending(rs.getObject("id",UUID.class),rs.getObject("class_id",UUID.class),
                        rs.getObject("teacher_id",UUID.class),rs.getObject("student_id",UUID.class),rs.getString("teacher_focus")),workerId)
                    .stream().findFirst().orElse(null);
            });
            if(job==null){busy.set(false);return;}
            worker.submit(()->{
                try {
                    var teacher=new AuthenticatedUser(job.teacherId(),null,Role.TEACHER);
                    var report=review.preview(teacher,job.classId(),job.studentId(),job.focus());
                    if("ERROR".equals(report.state()))throw new IllegalStateException("REPORT_PUPIL_NOT_AVAILABLE");
                    authorize(teacher,job.classId(),job.studentId());
                    jdbc.update("""
                        UPDATE completed_lesson_report_jobs SET state='DONE',result_json=CAST(? AS jsonb),
                          worker_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now()
                        WHERE id=? AND state='RUNNING' AND worker_id=? AND lease_until>now()
                        """,json.writeValueAsString(report),job.id(),workerId);
                } catch(Exception failure) {
                    LOG.warn("Completed lesson report failed job={} type={}",job.id(),failure.getClass().getSimpleName());
                    jdbc.update("""
                        UPDATE completed_lesson_report_jobs SET state='FAILED',failure_code=?,
                          worker_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now()
                        WHERE id=? AND state='RUNNING' AND worker_id=?
                        """,failure instanceof java.net.http.HttpTimeoutException?"AI_TIMEOUT":"ANALYSIS_FAILED",job.id(),workerId);
                } finally {busy.set(false);}
            });
        } catch(RuntimeException failure) {
            busy.set(false);
            LOG.warn("Completed lesson report queue error type={}",failure.getClass().getSimpleName());
        }
    }

    @PreDestroy
    void close(){worker.shutdownNow();}
}
