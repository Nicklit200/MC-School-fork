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
        Object[] parameters() {
            return new Object[]{classId,teacherId,studentId,boardId,pageNumber,
                    documentVersion,sharedDocumentVersion,revision,ANALYSIS_VERSION};
        }
    }
    public record Result(UUID id, UUID studentId, String boardId, int pageNumber,
                         long documentVersion, long sharedDocumentVersion, long revision,
                         String state, String text, String failureCode,
                         Instant capturedAt, Instant finishedAt) {}
    public record Claim(boolean acquired, Result result) {}
    public record Candidate(UUID studentId, String boardId, int pageNumber,
                            long documentVersion, long sharedDocumentVersion, long revision) {}
    private static final String EXACT = """
        class_id=? AND teacher_id=? AND student_id=? AND board_id=? AND page_number=?
        AND document_version=? AND shared_document_version=? AND ink_revision=? AND analysis_version=?
        """;
    private static final RowMapper<Result> MAPPER = (rs, i) -> {
        var finished = rs.getTimestamp("finished_at");
        return new Result(rs.getObject("id", UUID.class),rs.getObject("student_id",UUID.class),
                rs.getString("board_id"),rs.getInt("page_number"),rs.getLong("document_version"),
                rs.getLong("shared_document_version"),rs.getLong("ink_revision"),rs.getString("state"),
                rs.getString("analysis_text"),rs.getString("failure_code"),
                rs.getTimestamp("created_at").toInstant(),finished == null ? null : finished.toInstant());
    };
    private final JdbcTemplate jdbc;

    public KolinPageAnalysisStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** Verify the pupil actually authored an operation on this exact page.
     * Historical ink alone is not proof that any visible solution was independently produced. */
    public boolean hasPupilInk(Key key) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
            SELECT EXISTS (
                SELECT 1 FROM online_class_annotation_documents doc
                JOIN online_class_annotation_events ev ON ev.document_id=doc.id
                WHERE doc.class_id=? AND doc.target_type='WHITEBOARD'
                  AND doc.target_id=? AND doc.page_index=? AND doc.revision=?
                  AND ev.actor_id=? AND ev.operation_type IN ('ADD','UPDATE')
            )
            """,Boolean.class,key.classId(),key.boardId(),key.pageNumber()-1,key.revision(),key.studentId()));
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
            WHERE doc.class_id=? AND doc.target_type='WHITEBOARD' AND doc.target_id=?
              AND doc.page_index BETWEEN 0 AND 999 AND doc.revision>0
              AND doc.updated_at <= now() - interval '30 seconds'
              AND EXISTS (
                SELECT 1 FROM online_class_annotation_events ev
                WHERE ev.document_id=doc.id AND ev.actor_id=? AND ev.operation_type IN ('ADD','UPDATE')
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
                  AND a.ink_revision=doc.revision AND a.analysis_version=?
              )
            ORDER BY doc.updated_at,doc.page_index LIMIT 8
            """,(rs,i)->new Candidate(studentId,boardId,rs.getInt("page_index")+1,
                documentVersion,sharedVersion,rs.getLong("revision")),
                classId,boardId,studentId,studentId,teacherId,studentId,documentVersion,sharedVersion,ANALYSIS_VERSION);
    }

    /** The provider runs outside this short transaction. Never auto-retry a paid call
     * after an ambiguous failure or a lost process; a later ink revision is a new job. */
    @Transactional
    public Claim claim(Key key, String imageSha256) {
        UUID id = UUID.randomUUID();
        int inserted = jdbc.update("""
            INSERT INTO kolyn_page_analyses
              (id,class_id,teacher_id,student_id,board_id,page_number,document_version,
               shared_document_version,ink_revision,analysis_version,image_sha256,state)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,'RUNNING')
            ON CONFLICT ON CONSTRAINT uq_kolyn_page_analysis_revision DO NOTHING
            """,id,key.classId(),key.teacherId(),key.studentId(),key.boardId(),key.pageNumber(),
                key.documentVersion(),key.sharedDocumentVersion(),key.revision(),ANALYSIS_VERSION,imageSha256);
        if (inserted == 0) {
            jdbc.update("UPDATE kolyn_page_analyses SET state='FAILED',failure_code='ABANDONED',finished_at=now() WHERE "
                    + EXACT + " AND state='RUNNING' AND created_at < now() - interval '3 minutes'",key.parameters());
        }
        return new Claim(inserted==1, exact(key));
    }

    @Transactional
    public Result finish(Key key, UUID id, String text) {
        if (text == null || text.isBlank() || text.length() > 10000) throw new IllegalArgumentException("Invalid analysis");
        jdbc.update("""
            UPDATE kolyn_page_analyses SET state='READY',analysis_text=?,finished_at=now()
            WHERE id=? AND state='RUNNING'
            """,text,id);
        return exact(key);
    }

    @Transactional
    public Result fail(Key key, UUID id) {
        jdbc.update("""
            UPDATE kolyn_page_analyses SET state='FAILED',failure_code='ANALYSIS_FAILED',finished_at=now()
            WHERE id=? AND state='RUNNING'
            """,id);
        return exact(key);
    }

    /** Only receipts for the current PDF and current ink revision are returned to live consumers.
     * Earlier versions remain evidence for historical consumers, never a current verdict. */
    @Transactional(readOnly=true)
    public List<Result> current(UUID classId, UUID teacherId, UUID studentId, String boardId,
                                long documentVersion, long sharedVersion) {
        return jdbc.query("""
            SELECT a.* FROM kolyn_page_analyses a
            JOIN online_class_annotation_documents doc ON doc.class_id=a.class_id
              AND doc.target_type='WHITEBOARD' AND doc.target_id=a.board_id
              AND doc.page_index=a.page_number-1 AND doc.revision=a.ink_revision
            WHERE a.class_id=? AND a.teacher_id=? AND a.student_id=? AND a.board_id=?
              AND a.document_version=? AND a.shared_document_version=? AND a.analysis_version=?
            ORDER BY a.page_number LIMIT 100
            """,MAPPER,classId,teacherId,studentId,boardId,documentVersion,sharedVersion,ANALYSIS_VERSION);
    }

    private Result exact(Key key) {
        return jdbc.queryForObject("SELECT * FROM kolyn_page_analyses WHERE " + EXACT,MAPPER,key.parameters());
    }
}
