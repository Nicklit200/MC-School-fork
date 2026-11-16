package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Durable, teacher-scoped Kolyn memory. Only successful turns and review
 * receipts are stored; no screenshots, pencil strokes, audio, or source PDFs.
 * A review receipt means inspected, not correct.
 */
@Service
public class KolinLessonMemoryService {
    private static final int MAX_RECENT_TURNS = 8;
    private final OnlineClassAccessService access;
    private final JdbcTemplate jdbc;

    public KolinLessonMemoryService(OnlineClassAccessService access, JdbcTemplate jdbc) {
        this.access = access;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly=true)
    public List<Map<String,Object>> recent(AuthenticatedUser teacher, UUID classId) {
        access.requireHost(teacher, classId);
        List<Map<String,Object>> turns = jdbc.query("""
            SELECT question, reply_text, created_at FROM kolyn_lesson_memory_turns
            WHERE class_id = ? AND teacher_id = ?
            ORDER BY created_at DESC, client_message_id DESC LIMIT ?
            """, (rs,n) -> {
                var result = new LinkedHashMap<String,Object>();
                result.put("question", clip(rs.getString("question"), 750));
                result.put("answer", clip(rs.getString("reply_text"), 1300));
                result.put("at", rs.getTimestamp("created_at").toInstant().toString());
                return result;
            }, classId, teacher.id(), MAX_RECENT_TURNS);
        Collections.reverse(turns);
        return turns;
    }

    @Transactional
    public void remember(AuthenticatedUser teacher,UUID classId,UUID messageId,String question,
                         String answer,UUID studentId) {
        if(messageId==null || question==null || question.isBlank() || answer==null || answer.isBlank()) return;
        access.requireHost(teacher, classId);
        jdbc.update("""
            INSERT INTO kolyn_lesson_memory_turns
            (class_id,teacher_id,student_id,client_message_id,question,reply_text)
            VALUES (?,?,?,?,?,?) ON CONFLICT (class_id,teacher_id,client_message_id) DO NOTHING
            """,classId,teacher.id(),studentId,messageId,clip(question,4000),clip(answer,10000));
    }

    /** Past Kolyn reviews for an already-authorized pupil, including prior classes.
     * The caller must first validate the pupil's room membership and current
     * teacher assignment via KolinStudentHistoryContextService.
     */
    @Transactional(readOnly=true)
    List<Map<String,Object>> priorPupilMemory(AuthenticatedUser teacher,UUID currentClassId,UUID studentId) {
        access.requireHost(teacher,currentClassId);
        if(studentId==null) return List.of();
        // The pre-memory implementation already stored successful board
        // reviews in kolin_worksheets, tagged with the exact student UUID.
        // Include those historic reviews as well, not only newly saved chats.
        List<Map<String,Object>> rows=jdbc.query("""
            SELECT question, reply_text, logged_at FROM (
              SELECT question, reply_text, created_at AS logged_at
              FROM kolyn_lesson_memory_turns
              WHERE teacher_id=? AND student_id=? AND class_id<>?
              UNION ALL
              SELECT '[Проверка Kolyn из прежнего урока]' AS question,
                     reply_text, updated_at AS logged_at
              FROM kolin_worksheets
              WHERE teacher_id=? AND student_id=? AND class_id<>?
                AND result_type='text' AND state IN ('READY','ADDED')
                AND reply_text IS NOT NULL
            ) recent ORDER BY logged_at DESC LIMIT 12
            """,(rs,n)->{
                Map<String,Object> row=new LinkedHashMap<>();
                row.put("question",clip(rs.getString("question"),450));
                row.put("priorAnswerExcerpt",clip(rs.getString("reply_text"),1050));
                row.put("at",rs.getTimestamp("logged_at").toInstant().toString());
                return row;
            },teacher.id(),studentId,currentClassId,teacher.id(),studentId,currentClassId);
        var result=new ArrayList<Map<String,Object>>();
        var seen=new java.util.HashSet<String>();
        for(var row:rows) {
            String answer=(String)row.get("priorAnswerExcerpt");
            if(seen.add(answer)) result.add(row);
            if(result.size()==5) break;
        }
        return List.copyOf(result);
    }

    /**
     * Compare the current verified images to previously reviewed versions.
     * Never infer correctness from an unchanged snapshot.
     */
    @Transactional(readOnly=true)
    public List<Map<String,Object>> comparison(AuthenticatedUser teacher,UUID classId,
            KolinBoardReviewService.Metadata board) {
        access.requireHost(teacher,classId);
        var before = jdbc.query("""
            SELECT page_number, document_version, shared_document_version,
                   ink_revision, image_sha256, reviewed_at
            FROM kolyn_review_page_checkpoints
            WHERE class_id=? AND teacher_id=? AND board_id=?
            """, (rs,n)->new Previous(rs.getInt(1),rs.getLong(2),rs.getLong(3),
                    rs.getLong(4),rs.getString(5),rs.getTimestamp(6).toInstant()),
                    classId,teacher.id(),board.boardId());
        return classify(board,before);
    }

    static List<Map<String,Object>> classify(KolinBoardReviewService.Metadata board,List<Previous> before) {
        var byPage=new java.util.HashMap<Integer,Previous>();
        for(var row:before) byPage.put(row.pageNumber(),row);
        var result=new ArrayList<Map<String,Object>>();
        for(var page:board.pages()) {
            Previous previous=byPage.get(page.pageNumber());
            String state=previous==null?"not_checked":
                previous.documentVersion()!=board.documentVersion() ||
                previous.inkRevision()!=page.revision() ||
                !previous.imageSha256().equals(page.imageSha256())
                ? "changed_after_check" : "checked_unchanged";
            var item=new LinkedHashMap<String,Object>();
            item.put("pageNumber",page.pageNumber());
            item.put("state",state);
            if(previous!=null) item.put("lastReviewedAt",previous.reviewedAt().toString());
            result.add(item);
        }
        return List.copyOf(result);
    }

    /** A checkpoint is only written AFTER the provider produced a valid reply. */
    @Transactional
    public void rememberReview(AuthenticatedUser teacher,UUID classId,
            KolinBoardReviewService.Metadata board,
            KolinBoardReviewService.Snapshot snapshot) {
        access.requireHost(teacher,classId);
        long inherited=snapshot.sharedDocumentVersion()==null?-1:snapshot.sharedDocumentVersion();
        for(var page:board.pages()) {
            jdbc.update("""
                INSERT INTO kolyn_review_page_checkpoints
                  (class_id,teacher_id,board_id,page_number,document_version,
                   shared_document_version,ink_revision,image_sha256,page_count,reviewed_at)
                VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT (class_id,teacher_id,board_id,page_number) DO UPDATE SET
                  document_version=excluded.document_version,
                  shared_document_version=excluded.shared_document_version,
                  ink_revision=excluded.ink_revision,
                  image_sha256=excluded.image_sha256,
                  page_count=excluded.page_count,
                  reviewed_at=CURRENT_TIMESTAMP
                """, classId,teacher.id(),board.boardId(),page.pageNumber(),
                board.documentVersion(),inherited,page.revision(),page.imageSha256(),
                board.totalPageCount());
        }
    }

    record Previous(int pageNumber,long documentVersion,long sharedDocumentVersion,
                            long inkRevision,String imageSha256,Instant reviewedAt) {}

    private static String clip(String value,int max) {
        if(value==null) return "";
        String clean=value.strip();
        return clean.length()<=max ? clean : clean.substring(0,max);
    }
}
