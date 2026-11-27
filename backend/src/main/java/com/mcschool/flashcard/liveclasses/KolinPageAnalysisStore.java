package com.mcschool.flashcard.liveclasses;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Durable, versioned review receipts. The unique key, not a local Java lock,
 * elects exactly one provider caller across concurrent tabs and replicas.
 * Never store the snapshot, audio, or raw provider response.
 */
@Repository
public class KolinPageAnalysisStore {
    static final int ANALYSIS_VERSION = 1;
    public record Key(UUID classId, UUID teacherId, UUID studentId, String boardId,
                      int pageNumber, long documentVersion, long sharedDocumentVersion, long revision) {
        public Key {
            if (classId == null || teacherId == null || studentId == null ||
                    !PersonalBoard.ownerOf(boardId).filter(studentId::equals).isPresent() ||
                    pageNumber < 1 || pageNumber > 1000 || documentVersion < 0 ||
                    sharedDocumentVersion < 0 || revision <= 0)
                throw KolinRequestException.reviewUnavailable();
        }
        Object[] parameters(long pupilRevision) {
            return new Object[]{classId,teacherId,studentId,boardId,pageNumber,
                    documentVersion,sharedDocumentVersion,pupilRevision,ANALYSIS_VERSION};
        }
    }
    public record Result(UUID id, UUID studentId, String boardId, int pageNumber,
                         long documentVersion, long sharedDocumentVersion, long revision,
                         String state, String text, String failureCode,
                         Instant capturedAt, Instant finishedAt) {}
    /** A durable receipt plus whether it still matches the pupil's latest ink revision. */
    public record SavedResult(UUID id, UUID studentId, String boardId, int pageNumber,
                              long documentVersion, long sharedDocumentVersion, long revision,
                              String state, String text, String failureCode,
                              Instant capturedAt, Instant finishedAt, boolean isCurrent) {}
    public record Claim(boolean acquired, Result result) {}
    public record Candidate(UUID studentId, String boardId, int pageNumber,
                            long documentVersion, long sharedDocumentVersion, long revision) {}
    private static final String EXACT = """
        class_id=? AND teacher_id=? AND student_id=? AND board_id=? AND page_number=?
        AND document_version=? AND shared_document_version=? AND pupil_ink_revision=? AND analysis_version=?
        """;
    private static final RowMapper<Result> MAPPER = (rs, i) -> {
        var finished = rs.getTimestamp("finished_at");
        var created=rs.getTimestamp("created_at").toInstant();
        String state=rs.getString("state");
        boolean expired="RUNNING".equals(state) && created.isBefore(Instant.now().minusSeconds(180));
        return new Result(rs.getObject("id", UUID.class),rs.getObject("student_id",UUID.class),
                rs.getString("board_id"),rs.getInt("page_number"),rs.getLong("document_version"),
                rs.getLong("shared_document_version"),rs.getLong("ink_revision"),expired?"FAILED":state,
                rs.getString("analysis_text"),expired?"ABANDONED":rs.getString("failure_code"),
                created,finished == null ? null : finished.toInstant());
    };
    private static final RowMapper<SavedResult> SAVED_MAPPER = (rs, i) -> {
        Result result=MAPPER.mapRow(rs,i);
        return new SavedResult(result.id(),result.studentId(),result.boardId(),result.pageNumber(),
                result.documentVersion(),result.sharedDocumentVersion(),result.revision(),result.state(),
                result.text(),result.failureCode(),result.capturedAt(),result.finishedAt(),rs.getBoolean("is_current"));
    };
    private final JdbcTemplate jdbc;

    public KolinPageAnalysisStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public record UsageTotals(long checks,long uniqueRevisions,long aiRequests,long cacheHits,long inProgressReuses,
                              long failedReuses,long inputTokens,long cachedInputTokens,long outputTokens,
                              long reasoningTokens,java.math.BigDecimal costUsd,boolean costComplete) {}
    public record PageUsage(UUID studentId,String studentName,String boardId,int pageNumber,long checks,
                            long uniqueRevisions,long aiRequests,long cacheHits,long inputTokens,long outputTokens,
                            java.math.BigDecimal costUsd,boolean costComplete) {}

    @Transactional
    public UUID startUsage(Key key,UUID analysisId,String model,String eventType) {
        UUID id=UUID.randomUUID();
        jdbc.update("""
          INSERT INTO kolyn_page_analysis_usage_events
          (id,analysis_id,class_id,teacher_id,student_id,board_id,page_number,pupil_ink_revision,event_type,state,model_name)
          SELECT ?,id,class_id,teacher_id,student_id,board_id,page_number,pupil_ink_revision,?,'STARTED',?
          FROM kolyn_page_analyses WHERE id=? AND class_id=? AND teacher_id=? AND student_id=?
          """,id,eventType,model,analysisId,key.classId(),key.teacherId(),key.studentId());
        return id;
    }

    @Transactional
    public void finishUsage(UUID id,String state,String responseId,Long input,Long cached,Long output,Long reasoning,
            java.math.BigDecimal inputPrice,java.math.BigDecimal cachedPrice,java.math.BigDecimal outputPrice) {
        java.math.BigDecimal cost=null;
        if(input!=null && output!=null && inputPrice!=null && cachedPrice!=null && outputPrice!=null) {
            long cache=Math.min(input,cached==null?0L:cached);
            cost=java.math.BigDecimal.valueOf(input-cache).multiply(inputPrice)
                .add(java.math.BigDecimal.valueOf(cache).multiply(cachedPrice))
                .add(java.math.BigDecimal.valueOf(output).multiply(outputPrice))
                .divide(java.math.BigDecimal.valueOf(1_000_000),10,java.math.RoundingMode.HALF_UP);
        }
        jdbc.update("""
          UPDATE kolyn_page_analysis_usage_events SET state=?,response_id=?,input_tokens=?,cached_input_tokens=?,
          output_tokens=?,reasoning_tokens=?,input_price_usd_per_million=?,cached_input_price_usd_per_million=?,
          output_price_usd_per_million=?,cost_usd=?,finished_at=now() WHERE id=?
          """,state,responseId,input,cached,output,reasoning,inputPrice,cachedPrice,outputPrice,cost,id);
    }

    @Transactional(readOnly=true)
    public UsageTotals usageTotals(UUID classId,UUID teacherId) {
        var row=jdbc.queryForMap("""
          SELECT count(*) checks,
          count(DISTINCT(student_id,board_id,page_number,pupil_ink_revision)) unique_revisions,
          count(*) FILTER(WHERE event_type='AI_REQUEST') ai_requests,
          count(*) FILTER(WHERE event_type='CACHE_HIT') cache_hits,
          count(*) FILTER(WHERE event_type='IN_PROGRESS_REUSE') in_progress_reuses,
          count(*) FILTER(WHERE event_type='FAILED_REUSE') failed_reuses,
          COALESCE(sum(input_tokens),0) input_tokens,COALESCE(sum(cached_input_tokens),0) cached_input_tokens,
          COALESCE(sum(output_tokens),0) output_tokens,COALESCE(sum(reasoning_tokens),0) reasoning_tokens,
          sum(cost_usd) cost_usd,
          COALESCE(bool_and(state='SUCCEEDED' AND cost_usd IS NOT NULL) FILTER(WHERE event_type='AI_REQUEST'),false) cost_complete
          FROM kolyn_page_analysis_usage_events WHERE class_id=? AND teacher_id=?
          """,classId,teacherId);
        return new UsageTotals(n(row,"checks"),n(row,"unique_revisions"),n(row,"ai_requests"),n(row,"cache_hits"),
          n(row,"in_progress_reuses"),n(row,"failed_reuses"),n(row,"input_tokens"),n(row,"cached_input_tokens"),
          n(row,"output_tokens"),n(row,"reasoning_tokens"),(java.math.BigDecimal)row.get("cost_usd"),
          Boolean.TRUE.equals(row.get("cost_complete")));
    }
    @Transactional(readOnly=true)
    public List<PageUsage> pageUsage(UUID classId,UUID teacherId) {
        return jdbc.query("""
          SELECT e.student_id,u.full_name student_name,e.board_id,e.page_number,
          count(*) checks,
          count(DISTINCT e.pupil_ink_revision) unique_revisions,
          count(*) FILTER(WHERE e.event_type='AI_REQUEST') ai_requests,
          count(*) FILTER(WHERE e.event_type='CACHE_HIT') cache_hits,
          COALESCE(sum(e.input_tokens),0) input_tokens,COALESCE(sum(e.output_tokens),0) output_tokens,
          sum(e.cost_usd) cost_usd,
          COALESCE(bool_and(e.state='SUCCEEDED' AND e.cost_usd IS NOT NULL) FILTER(WHERE e.event_type='AI_REQUEST'),false) cost_complete
          FROM kolyn_page_analysis_usage_events e JOIN users u ON u.id=e.student_id
          WHERE e.class_id=? AND e.teacher_id=? GROUP BY e.student_id,u.full_name,e.board_id,e.page_number
          ORDER BY u.full_name,e.board_id,e.page_number
          """,(rs,i)->new PageUsage(rs.getObject("student_id",UUID.class),rs.getString("student_name"),
          rs.getString("board_id"),rs.getInt("page_number"),rs.getLong("checks"),rs.getLong("unique_revisions"),
          rs.getLong("ai_requests"),rs.getLong("cache_hits"),rs.getLong("input_tokens"),rs.getLong("output_tokens"),
          rs.getBigDecimal("cost_usd"),rs.getBoolean("cost_complete")),classId,teacherId);
    }
    private static long n(java.util.Map<String,Object> row,String key) {
        Object value=row.get(key); return value instanceof Number number?number.longValue():0L;
    }


    /**
     * A page's pupil-layer version changes only when its own layer changes or
     * the board is cleared. Teacher ink on a separate layer is not a new paid
     * review. Full document revision still guards the captured image.
     */
    private Long eligiblePupilRevision(Key key) {
        return jdbc.query("""
            SELECT pupil_ink.sequence
            FROM online_class_annotation_documents doc
            JOIN LATERAL (
                SELECT ev.sequence
                FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id
                  AND ev.layer_owner_id=?
                  AND ev.operation_type IN ('ADD','UPDATE')
                  AND ev.sequence > COALESCE((
                    SELECT MAX(cl.sequence) FROM online_class_annotation_events cl
                    WHERE cl.document_id=doc.id AND (cl.operation_type='CLEAR_ALL'
                      OR (cl.operation_type='CLEAR_LAYER' AND cl.layer_owner_id=?))
                  ),0)
                ORDER BY ev.sequence DESC LIMIT 1
            ) pupil_ink ON true
            WHERE doc.class_id=? AND doc.target_type='WHITEBOARD'
              AND doc.target_id=? AND doc.page_index=? AND doc.revision=?
            """,(rs,i)->rs.getLong(1),key.studentId(),key.studentId(),key.classId(),key.boardId(),
                key.pageNumber()-1,key.revision())
                .stream().findFirst().orElse(null);
    }

    public boolean hasPupilInk(Key key) {
        return eligiblePupilRevision(key)!=null;
    }

    /** Durable metadata only; no PDF/image bytes are read to find new pupil writing.
     * Teacher ink, erasing, undo and redo do not trigger another paid review.
     * The final renderer separately discards pages with no visible pupil ink. */
    @Transactional(readOnly=true)
    public List<Candidate> candidates(UUID classId, UUID teacherId, UUID studentId, String boardId,
                                      long documentVersion, long sharedVersion) {
        return jdbc.query("""
            SELECT doc.page_index,doc.revision
            FROM online_class_annotation_documents doc
            JOIN LATERAL (
                SELECT ev.sequence
                FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id
                  AND ev.layer_owner_id=?
                  AND ev.operation_type IN ('ADD','UPDATE')
                  AND ev.sequence > COALESCE((
                    SELECT MAX(cl.sequence) FROM online_class_annotation_events cl
                    WHERE cl.document_id=doc.id AND (cl.operation_type='CLEAR_ALL'
                      OR (cl.operation_type='CLEAR_LAYER' AND cl.layer_owner_id=?))
                  ),0)
                ORDER BY ev.sequence DESC LIMIT 1
            ) pupil_ink ON true
            WHERE doc.class_id=? AND doc.target_type='WHITEBOARD' AND doc.target_id=?
              AND doc.page_index BETWEEN 0 AND 999 AND doc.revision>0
              AND NOT EXISTS (
                SELECT 1 FROM kolyn_page_analyses a
                WHERE a.class_id=doc.class_id AND a.teacher_id=? AND a.student_id=?
                  AND a.board_id=doc.target_id AND a.page_number=doc.page_index+1
                  AND a.pupil_ink_revision=pupil_ink.sequence AND a.analysis_version=?
              )
            ORDER BY doc.page_index LIMIT 1000
            """,(rs,i)->new Candidate(studentId,boardId,rs.getInt("page_index")+1,
                documentVersion,sharedVersion,rs.getLong("revision")),
                studentId,studentId,classId,boardId,teacherId,studentId,ANALYSIS_VERSION);
    }

    /** The provider runs outside this short transaction. A pupil's exact ink revision
     * can only be claimed once, regardless of later PDF/background version changes. */
    @Transactional
    public Claim claim(Key key, String imageSha256) {
        Long pupilRevision=eligiblePupilRevision(key);
        if(pupilRevision==null)throw KolinRequestException.reviewUnavailable();
        UUID id = UUID.randomUUID();
        int inserted = jdbc.update("""
            INSERT INTO kolyn_page_analyses
              (id,class_id,teacher_id,student_id,board_id,page_number,document_version,
               shared_document_version,ink_revision,pupil_ink_revision,analysis_version,image_sha256,state)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'RUNNING')
            ON CONFLICT (class_id,teacher_id,student_id,board_id,page_number,pupil_ink_revision,analysis_version) DO NOTHING
            """,id,key.classId(),key.teacherId(),key.studentId(),key.boardId(),key.pageNumber(),
                key.documentVersion(),key.sharedDocumentVersion(),key.revision(),pupilRevision,ANALYSIS_VERSION,imageSha256);
        if (inserted == 0) {
            jdbc.update("""
                UPDATE kolyn_page_analyses SET state='FAILED',failure_code='ABANDONED',finished_at=now()
                WHERE class_id=? AND teacher_id=? AND student_id=? AND board_id=? AND page_number=?
                  AND pupil_ink_revision=? AND analysis_version=? AND state='RUNNING'
                  AND created_at < now() - interval '3 minutes'
                """,key.classId(),key.teacherId(),key.studentId(),key.boardId(),key.pageNumber(),
                    pupilRevision,ANALYSIS_VERSION);
            return new Claim(false,jdbc.queryForObject("""
                SELECT * FROM kolyn_page_analyses
                WHERE class_id=? AND teacher_id=? AND student_id=? AND board_id=? AND page_number=?
                  AND pupil_ink_revision=? AND analysis_version=?
                ORDER BY CASE state WHEN 'READY' THEN 0 WHEN 'RUNNING' THEN 1 ELSE 2 END,
                         created_at DESC,id DESC
                LIMIT 1
                """,MAPPER,key.classId(),key.teacherId(),key.studentId(),key.boardId(),key.pageNumber(),
                    pupilRevision,ANALYSIS_VERSION));
        }
        return new Claim(true,exact(key,pupilRevision));
    }

    @Transactional
    public Result finish(Key key, UUID id, String text) {
        if (text == null || text.isBlank() || text.length() > 10000) throw new IllegalArgumentException("Invalid analysis");
        jdbc.update("""
            UPDATE kolyn_page_analyses SET state='READY',analysis_text=?,finished_at=now()
            WHERE id=? AND state='RUNNING'
            """,text,id);
        return byId(key,id);
    }

    @Transactional
    public Result fail(Key key, UUID id) {
        jdbc.update("""
            UPDATE kolyn_page_analyses SET state='FAILED',failure_code='ANALYSIS_FAILED',finished_at=now()
            WHERE id=? AND state='RUNNING'
            """,id);
        return byId(key,id);
    }

    /**
     * Return durable receipts for the current workbook version, including older ink
     * revisions. A newer pupil stroke must not make the last completed check disappear
     * while the next revision waits for its quiet window or is being analysed.
     * isCurrent distinguishes a verdict for the latest pupil ink from a preserved
     * historical verdict. The UI can show both the last READY result and a newer RUNNING
     * or FAILED attempt without ever presenting stale feedback as a current verdict.
     */
    @Transactional(readOnly=true)
    public List<SavedResult> current(UUID classId, UUID teacherId, UUID studentId, String boardId,
                                     long documentVersion, long sharedVersion) {
        return jdbc.query("""
            SELECT a.*,
                   COALESCE(a.document_version=? AND a.shared_document_version=?
                       AND latest.sequence = a.pupil_ink_revision, false) AS is_current
            FROM kolyn_page_analyses a
            LEFT JOIN online_class_annotation_documents doc ON doc.class_id=a.class_id
              AND doc.target_type='WHITEBOARD' AND doc.target_id=a.board_id
              AND doc.page_index=a.page_number-1
            LEFT JOIN LATERAL (
                SELECT ev.sequence FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id
                  AND (ev.layer_owner_id=a.student_id OR ev.operation_type='CLEAR_ALL')
                ORDER BY ev.sequence DESC LIMIT 1
            ) latest ON true
            WHERE a.class_id=? AND a.teacher_id=? AND a.student_id=? AND a.board_id=?
              AND a.analysis_version=?
            ORDER BY a.page_number, a.created_at DESC, a.id DESC LIMIT 500
            """,SAVED_MAPPER,documentVersion,sharedVersion,classId,teacherId,studentId,boardId,ANALYSIS_VERSION);
    }

    private Result exact(Key key,long pupilRevision) {
        return jdbc.queryForObject("SELECT * FROM kolyn_page_analyses WHERE " + EXACT,MAPPER,key.parameters(pupilRevision));
    }

    private Result byId(Key key,UUID id) {
        return jdbc.queryForObject("SELECT * FROM kolyn_page_analyses WHERE id=? AND class_id=? AND teacher_id=? AND student_id=?",
                MAPPER,id,key.classId(),key.teacherId(),key.studentId());
    }
}
