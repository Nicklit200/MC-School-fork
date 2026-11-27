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

    /**
     * A page's pupil-layer version changes only when its own layer changes or
     * the board is cleared. Teacher ink on a separate layer is not a new paid
     * review. Full document revision still guards the captured image.
     */
    private Long eligiblePupilRevision(Key key) {
        return jdbc.query("""
            SELECT latest.sequence
            FROM online_class_annotation_documents doc
            JOIN LATERAL (
                SELECT ev.sequence,ev.created_at FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id
                  AND (ev.layer_owner_id=? OR ev.operation_type='CLEAR_ALL')
                ORDER BY ev.sequence DESC LIMIT 1
            ) latest ON true
            WHERE doc.class_id=? AND doc.target_type='WHITEBOARD'
              AND doc.target_id=? AND doc.page_index=? AND doc.revision=?
              AND latest.created_at <= now() - interval '30 seconds'
              AND EXISTS (
                SELECT 1 FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id AND ev.actor_id=? AND ev.layer_owner_id=?
                  AND ev.operation_type IN ('ADD','UPDATE')
                  AND ev.sequence > COALESCE((
                    SELECT MAX(cl.sequence) FROM online_class_annotation_events cl
                    WHERE cl.document_id=doc.id AND (cl.operation_type='CLEAR_ALL'
                      OR (cl.operation_type='CLEAR_LAYER' AND cl.layer_owner_id=?))
                  ),0)
              )
            """,(rs,i)->rs.getLong(1),key.studentId(),key.classId(),key.boardId(),
                key.pageNumber()-1,key.revision(),key.studentId(),key.studentId(),key.studentId())
                .stream().findFirst().orElse(null);
    }

    public boolean hasPupilInk(Key key) {
        return eligiblePupilRevision(key)!=null;
    }

    /** Durable metadata only; no PDF/image bytes are read to find settled revisions.
     * Require a real pupil operation since the last layer/all clear.
     * The final renderer separately discards pages with no visible pupil ink. */
    @Transactional(readOnly=true)
    public List<Candidate> candidates(UUID classId, UUID teacherId, UUID studentId, String boardId,
                                      long documentVersion, long sharedVersion) {
        return jdbc.query("""
            SELECT doc.page_index,doc.revision
            FROM online_class_annotation_documents doc
            JOIN LATERAL (
                SELECT ev.sequence,ev.created_at FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id
                  AND (ev.layer_owner_id=? OR ev.operation_type='CLEAR_ALL')
                ORDER BY ev.sequence DESC LIMIT 1
            ) latest ON true
            WHERE doc.class_id=? AND doc.target_type='WHITEBOARD' AND doc.target_id=?
              AND doc.page_index BETWEEN 0 AND 999 AND doc.revision>0
              AND latest.created_at <= now() - interval '30 seconds'
              AND EXISTS (
                SELECT 1 FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id AND ev.actor_id=? AND ev.layer_owner_id=? AND ev.operation_type IN ('ADD','UPDATE')
                  AND ev.sequence > COALESCE((
                    SELECT MAX(cl.sequence) FROM online_class_annotation_events cl
                    WHERE cl.document_id=doc.id AND (cl.operation_type='CLEAR_ALL'
                      OR (cl.operation_type='CLEAR_LAYER' AND cl.layer_owner_id=?))
                  ),0)
              )
              AND NOT EXISTS (
                SELECT 1 FROM kolyn_page_analyses a
                WHERE a.class_id=doc.class_id AND a.teacher_id=? AND a.student_id=?
                  AND a.board_id=doc.target_id AND a.page_number=doc.page_index+1
                  AND a.document_version=? AND a.shared_document_version=?
                  AND a.pupil_ink_revision=latest.sequence AND a.analysis_version=?
              )
            ORDER BY latest.created_at,doc.page_index LIMIT 8
            """,(rs,i)->new Candidate(studentId,boardId,rs.getInt("page_index")+1,
                documentVersion,sharedVersion,rs.getLong("revision")),
                studentId,classId,boardId,studentId,studentId,studentId,teacherId,studentId,documentVersion,sharedVersion,ANALYSIS_VERSION);
    }

    /** The provider runs outside this short transaction. Never auto-retry a paid call
     * after an ambiguous failure or a lost process; a later ink revision is a new job. */
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
            ON CONFLICT ON CONSTRAINT uq_kolyn_page_analysis_revision DO NOTHING
            """,id,key.classId(),key.teacherId(),key.studentId(),key.boardId(),key.pageNumber(),
                key.documentVersion(),key.sharedDocumentVersion(),key.revision(),pupilRevision,ANALYSIS_VERSION,imageSha256);
        if (inserted == 0) {
            jdbc.update("UPDATE kolyn_page_analyses SET state='FAILED',failure_code='ABANDONED',finished_at=now() WHERE "
                    + EXACT + " AND state='RUNNING' AND created_at < now() - interval '3 minutes'",key.parameters(pupilRevision));
        }
        return new Claim(inserted==1, exact(key,pupilRevision));
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
