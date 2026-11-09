package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Polling never waits for AI or rendering. Generation still uses the existing renderer and receipts. */
@Service
public class WorkbookGenerationJobService {
    private static final Logger LOG = LoggerFactory.getLogger(WorkbookGenerationJobService.class);
    private final JdbcTemplate jdbc;
    private final McpAccessService access;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private final UUID workerId = UUID.randomUUID();
    private final Set<UUID> running = ConcurrentHashMap.newKeySet();
    private final ExecutorService executor;
    private final int maxConcurrentJobs;
    private final int maxPendingPerActor;
    private final int maxGlobalActiveJobs;
    private volatile Generator generator;

    @FunctionalInterface public interface Generator {
        Map<String,Object> generate(AuthenticatedUser actor, Map<String,Object> arguments) throws Exception;
    }
    record Job(UUID id, UUID actorId, Role actorRole, UUID teacherId, String eventId, String hash,
               String request, String state, UUID draftId, String failure, Instant createdAt) {}

    /**
     * Production runs at most three background jobs in parallel. The renderer has
     * four permits, leaving one available for interactive Kolin work.
     */
    @Autowired
    public WorkbookGenerationJobService(JdbcTemplate jdbc, McpAccessService access, ObjectMapper json,
            PlatformTransactionManager transactions,
            @Value("${app.workbook-jobs.concurrency:3}") int maxConcurrentJobs,
            @Value("${app.workbook-jobs.max-pending-per-actor:24}") int maxPendingPerActor,
            @Value("${app.workbook-jobs.max-global-active:60}") int maxGlobalActiveJobs) {
        if (maxConcurrentJobs < 1 || maxConcurrentJobs > 3)
            throw new IllegalArgumentException("Workbook job concurrency must be between 1 and 3");
        if (maxPendingPerActor < maxConcurrentJobs || maxPendingPerActor > 100)
            throw new IllegalArgumentException("Workbook per-account queue limit must be between concurrency and 100");
        if (maxGlobalActiveJobs < maxPendingPerActor || maxGlobalActiveJobs > 500)
            throw new IllegalArgumentException("Workbook global queue limit must be between per-account limit and 500");
        this.jdbc=jdbc; this.access=access; this.json=json; this.tx=new TransactionTemplate(transactions);
        this.maxConcurrentJobs=maxConcurrentJobs;
        this.maxPendingPerActor=maxPendingPerActor;
        this.maxGlobalActiveJobs=maxGlobalActiveJobs;
        java.util.concurrent.atomic.AtomicInteger threadNumber=new java.util.concurrent.atomic.AtomicInteger();
        this.executor=Executors.newFixedThreadPool(maxConcurrentJobs,r->{
            Thread thread=new Thread(r,"mch3-workbook-generator-"+threadNumber.incrementAndGet());
            thread.setDaemon(true);return thread;
        });
    }

    /** Compatibility constructor for focused unit tests and local callers. */
    public WorkbookGenerationJobService(JdbcTemplate jdbc, McpAccessService access, ObjectMapper json,
                                         PlatformTransactionManager transactions) {
        this(jdbc,access,json,transactions,3,24,60);
    }
    public void setGenerator(Generator generator) { this.generator=Objects.requireNonNull(generator); }

    public Map<String,Object> enqueue(AuthenticatedUser actor, UUID teacherId, String eventId,
                                      String key, Map<String,Object> arguments) {
        AuthenticatedUser current=access.requireCurrentActor(actor);
        access.requireTeacher(current,teacherId);
        if(key==null||key.isBlank()||key.length()>128)throw new IllegalArgumentException("idempotencyKey must contain 1..128 characters");
        String request=json.writeValueAsString(new TreeMap<>(arguments));
        if(request.getBytes(StandardCharsets.UTF_8).length>750000)throw new IllegalArgumentException("Workbook request is too large");
        String hash=hash(request);
        return tx.execute(status -> {
            // Serialize only short enqueue checks. Global lock first makes the
            // school-wide capacity check atomic across different teacher accounts.
            // Generation/rendering never runs while either advisory lock is held.
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtext(?))",Object.class,"mch3-workbook-generation-global");
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtext(?))",Object.class,current.id().toString());
            var existing=jdbc.query("SELECT * FROM workbook_generation_jobs WHERE actor_id=? AND teacher_id=? AND idempotency_key=?",
                    this::row,current.id(),teacherId,key);
            if(!existing.isEmpty()) {
                if(!existing.get(0).hash().equals(hash))throw new ResponseStatusException(HttpStatus.CONFLICT,"This idempotencyKey belongs to a different request");
                return info(existing.get(0));
            }
            Integer actorCount=jdbc.queryForObject("SELECT count(*) FROM workbook_generation_jobs WHERE actor_id=? AND state IN ('QUEUED','RUNNING')",Integer.class,current.id());
            if(actorCount!=null&&actorCount>=maxPendingPerActor)
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "This account already has "+actorCount+" active workbook jobs. The per-account limit is "+maxPendingPerActor+"; wait for completed jobs before submitting more.");
            Integer globalCount=jdbc.queryForObject("SELECT count(*) FROM workbook_generation_jobs WHERE state IN ('QUEUED','RUNNING')",Integer.class);
            if(globalCount!=null&&globalCount>=maxGlobalActiveJobs)
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "The school workbook queue is full ("+globalCount+"/"+maxGlobalActiveJobs+" active jobs). Existing jobs remain safe; retry after some complete.");
            UUID id=UUID.randomUUID();
            jdbc.update("INSERT INTO workbook_generation_jobs(id,actor_id,actor_role,teacher_id,event_id,idempotency_key,payload_hash,request_json) VALUES (?,?,?,?,?,?,?,?)",
                    id,current.id(),current.role().name(),teacherId,eventId,key,hash,request);
            LOG.info("MCH3 workbook job={} state=QUEUED role={}",id,current.role());
            return info(load(id));
        });
    }

    public Map<String,Object> status(AuthenticatedUser actor, UUID id) {
        AuthenticatedUser current=access.requireCurrentActor(actor);
        Job job=load(id);
        // A different teacher (or even a different admin) cannot use a guessed job ID.
        if(!job.actorId().equals(current.id())||job.actorRole()!=current.role())throw denied();
        access.requireTeacher(current,job.teacherId());
        return info(job);
    }

    @Scheduled(fixedDelayString="${app.workbook-jobs.poll-ms:2000}",initialDelayString="${app.workbook-jobs.initial-ms:5000}")
    public synchronized void tick() {
        if(generator==null||executor.isShutdown())return;

        // Keep every in-flight worker's lease alive. A job can legitimately
        // take 115 seconds, and concurrent jobs must not expire one another.
        for(UUID active:running) {
            jdbc.update("UPDATE workbook_generation_jobs SET lease_until=CURRENT_TIMESTAMP+INTERVAL '90 seconds' WHERE id=? AND state='RUNNING' AND worker_id=?",active,workerId);
        }

        // Never repeat a possibly charged API call after a process crash.
        jdbc.update("UPDATE workbook_generation_jobs SET state='FAILED', failure_code='INTERRUPTED', completed_at=CURRENT_TIMESTAMP, request_json=NULL WHERE state='RUNNING' AND lease_until<CURRENT_TIMESTAMP");

        // Claim only as many jobs as there are free worker slots. SKIP LOCKED
        // keeps this safe if Railway ever runs more than one backend replica.
        while(running.size()<maxConcurrentJobs) {
            Job claimed=tx.execute(status -> {
                var jobs=jdbc.query("SELECT * FROM workbook_generation_jobs WHERE state='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",this::row);
                if(jobs.isEmpty())return null;
                Job job=jobs.get(0);
                jdbc.update("UPDATE workbook_generation_jobs SET state='RUNNING',started_at=CURRENT_TIMESTAMP,worker_id=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '90 seconds' WHERE id=?",workerId,job.id());
                return job;
            });
            if(claimed==null)return;
            running.add(claimed.id());
            try {
                executor.execute(()->run(claimed));
            } catch(RejectedExecutionException stopped) {
                running.remove(claimed.id());
                fail(claimed,"INTERRUPTED",stopped,0);
                return;
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void run(Job job) {
        long start=System.nanoTime();
        LOG.info("MCH3 workbook job={} state=RUNNING",job.id());
        try {
            // Commit the draft, existing idempotency receipt, and job completion together.
            tx.executeWithoutResult(status -> {
                AuthenticatedUser actor=access.requireCurrentActor(new AuthenticatedUser(job.actorId(),null,job.actorRole()));
                access.requireTeacher(actor,job.teacherId());
                try {
                    Map<String,Object> result=generator.generate(actor,json.readValue(job.request(),Map.class));
                    UUID draftId=UUID.fromString(String.valueOf(result.get("draftId")));
                    int updated=jdbc.update("UPDATE workbook_generation_jobs SET state='SUCCEEDED',draft_id=?,completed_at=CURRENT_TIMESTAMP,request_json=NULL WHERE id=? AND state='RUNNING' AND worker_id=?",
                            draftId,job.id(),workerId);
                    if(updated!=1)throw new IllegalStateException("Generation lease lost");
                } catch(RuntimeException ex) { throw ex; }
                catch(Exception ex) { throw new IllegalStateException("Workbook generation failed",ex); }
            });
            LOG.info("MCH3 workbook job={} state=SUCCEEDED durationMs={}",job.id(),(System.nanoTime()-start)/1_000_000);
        } catch(Exception ex) {
            fail(job,failureCode(ex),ex,(System.nanoTime()-start)/1_000_000);
        } finally { SecurityContextHolder.clearContext(); running.remove(job.id()); }
    }
    private void fail(Job job,String code,Exception ex,long duration) {
        jdbc.update("UPDATE workbook_generation_jobs SET state='FAILED',failure_code=?,completed_at=CURRENT_TIMESTAMP,request_json=NULL WHERE id=? AND state='RUNNING' AND worker_id=?",code,job.id(),workerId);
        // Exception text can contain task content, model responses or a signed URL. Never log it.
        LOG.warn("MCH3 workbook job={} state=FAILED code={} errorType={} durationMs={}",job.id(),code,ex.getClass().getSimpleName(),duration);
    }
    static String failureCode(Throwable error) {
        for(Throwable ex=error;ex!=null;ex=ex.getCause()) {
            if(ex instanceof org.springframework.security.access.AccessDeniedException)return "ACCESS_CHANGED";
            if(ex instanceof java.net.http.HttpTimeoutException||ex instanceof TimeoutException)return "TIMEOUT";
            if(ex instanceof ResponseStatusException status && (status.getStatusCode().value()==401||status.getStatusCode().value()==403))return "ACCESS_CHANGED";
            String message=Objects.toString(ex.getMessage(),"");
            if(message.contains("exceeded 115 seconds")||message.contains("timed out"))return "TIMEOUT";
            if(message.startsWith("Server content generation is not configured"))return "AI_NOT_CONFIGURED";
            if(message.contains("Algebra QA")||message.contains("Algebra validation")||message.contains("Incorrect math in "))return "MATH_QA_FAILED";
            if(message.contains("Layout QA")||message.contains("layout check")||message.contains("overflow A4"))return "LAYOUT_QA_FAILED";
            if(ex instanceof IllegalArgumentException)return "VALIDATION_FAILED";
        }
        return "GENERATION_FAILED";
    }
    private Job load(UUID id) {
        var jobs=jdbc.query("SELECT * FROM workbook_generation_jobs WHERE id=?",this::row,id);
        if(jobs.isEmpty())throw denied();
        return jobs.get(0);
    }
    private Job row(ResultSet rs,int ignored)throws SQLException {
        return new Job(rs.getObject("id",UUID.class),rs.getObject("actor_id",UUID.class),Role.valueOf(rs.getString("actor_role")),
                rs.getObject("teacher_id",UUID.class),rs.getString("event_id"),rs.getString("payload_hash"),rs.getString("request_json"),
                rs.getString("state"),rs.getObject("draft_id",UUID.class),rs.getString("failure_code"),rs.getTimestamp("created_at").toInstant());
    }
    private Map<String,Object> info(Job job) {
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("jobId",job.id().toString());result.put("status",job.state());result.put("teacherId",job.teacherId().toString());
        result.put("eventId",job.eventId());result.put("createdAt",job.createdAt().toString());result.put("published",false);
        if(job.draftId()!=null)result.put("draftId",job.draftId().toString());
        if(job.failure()!=null) {
            result.put("errorCode",job.failure());
            result.put("errorMessage",switch(job.failure()) {
                case "ACCESS_CHANGED" -> "The school account or lesson access changed before generation finished.";
                case "TIMEOUT" -> "The content model or PDF renderer exceeded its time limit.";
                case "AI_NOT_CONFIGURED" -> "Server content generation is not configured. Prepare lessonJson with prepare_workbook_context instead.";
                case "MATH_QA_FAILED" -> "The generated tasks or answers did not pass mathematical validation.";
                case "LAYOUT_QA_FAILED" -> "The PDF would contain clipped or overlapping content. Reduce content per page.";
                case "VALIDATION_FAILED" -> "The task content or fresh lesson context failed validation.";
                case "INTERRUPTED" -> "The server stopped before completion was committed. No automatic regeneration was started.";
                default -> "Workbook generation failed. The job ID identifies the server diagnostic without exposing pupil data.";
            });
            result.put("nextStep",switch(job.failure()) {
                case "MATH_QA_FAILED" -> "No workbook was published. Recheck the exact mathematical results and qa.algebra assertions in your local lessonJson; regenerate only after correcting the content, using a fresh key for the changed request.";
                case "LAYOUT_QA_FAILED" -> "No workbook was published. Give each exercise enough A4 space, put large graphics or multiline work on separate pages, then request a new draft. Never shrink the required handwriting space.";
                case "VALIDATION_FAILED" -> "No workbook was published. Refresh prepare_workbook_context, check its rendererContract, correct the schema and actual lesson duration, then request a new draft with a new key.";
                case "AI_NOT_CONFIGURED" -> "No workbook was published. Use prepare_workbook_context, let ChatGPT prepare content-only lessonJson with qa.algebra, and call generate_lesson_workbook_draft with the fresh contextToken. No server-side AI is needed.";
                case "TIMEOUT" -> "No workbook was published. Check the requested page count and task complexity; do not automatically launch duplicate jobs. Simplify only after teacher review.";
                default -> "Generation stopped; no workbook was published. Do not automatically retry with a new idempotencyKey. Correct the cause before an explicit retry.";
            });
        } else if(!"SUCCEEDED".equals(job.state())) {
            result.put("retryAfterSeconds",5);
            result.put("nextStep","Call get_lesson_workbook_job with this jobId after at least 5 seconds. Do not start another generation. For multiple pupils, finish all jobs then refresh each get_lesson_draft immediately before presenting the five-minute download links.");
        }
        return result;
    }
    /** Aggregate queue telemetry only; no pupil, teacher or job identifiers are exposed. */
    public Map<String,Object> capacity(AuthenticatedUser actor) {
        AuthenticatedUser current=access.requireCurrentActor(actor);
        Integer own=jdbc.queryForObject("SELECT count(*) FROM workbook_generation_jobs WHERE actor_id=? AND state IN ('QUEUED','RUNNING')",Integer.class,current.id());
        Integer queued=jdbc.queryForObject("SELECT count(*) FROM workbook_generation_jobs WHERE state='QUEUED'",Integer.class);
        Integer active=jdbc.queryForObject("SELECT count(*) FROM workbook_generation_jobs WHERE state='RUNNING'",Integer.class);
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("activeForAccount",own==null?0:own);
        result.put("maxPendingPerAccount",maxPendingPerActor);
        result.put("queuedSchoolWide",queued==null?0:queued);
        result.put("runningSchoolWide",active==null?0:active);
        result.put("maxGlobalActive",maxGlobalActiveJobs);
        result.put("workersPerBackend",maxConcurrentJobs);
        Long oldestWaitSeconds=jdbc.queryForObject(
                "SELECT COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN(created_at))),0)::bigint FROM workbook_generation_jobs WHERE state='QUEUED'",
                Long.class);
        result.put("oldestQueuedSeconds",oldestWaitSeconds==null?0:oldestWaitSeconds);
        return result;
    }

    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(java.security.NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    private static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.NOT_FOUND,"Workbook job is unavailable for this account"); }
    @PreDestroy public void close() { executor.shutdownNow(); }
}
