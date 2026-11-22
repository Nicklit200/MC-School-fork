package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * An auditable observation is not an inferred score. Authorized staff or the
 * connector must explicitly supply a concrete observation and its provenance.
 * Mastery remains in student_skill_mastery; the calendar reads that table.
 */
@Service
public class SkillEvidenceService {
    public record Evidence(UUID id, String skillId, String sourceType, String sourceRef,
                           String autonomy, String explanation, String sourceExcerpt,
                           Instant observedAt, Instant recordedAt, Integer masteryAfter,
                           UUID supersedesId, String correctionReason) {}
    public record Observation(String skillId, String sourceType, String sourceRef,
                              String autonomy, String explanation, String sourceExcerpt,
                              Instant observedAt, Integer masteryAfter,
                              UUID supersedesId, String correctionReason, String idempotencyKey) {}
    public record Recorded(Evidence evidence, SkillMasteryService.MasterySnapshot snapshot, boolean replayed) {}

    private final JdbcTemplate jdbc;
    private final SkillMasteryService mastery;
    private final SkillBoardService boards;

    public SkillEvidenceService(JdbcTemplate jdbc, SkillMasteryService mastery, SkillBoardService boards) {
        this.jdbc=jdbc;this.mastery=mastery;this.boards=boards;
    }

    @Transactional(readOnly=true)
    public List<Evidence> list(String boardId, UUID studentId, AuthenticatedUser caller) {
        mastery.get(boardId,studentId,caller); // identical staff/ownership authorization
        return jdbc.query("""
            SELECT id, skill_id, source_type, source_ref, autonomy, explanation,
                   source_excerpt, observed_at, recorded_at, mastery_after,
                   supersedes_id, correction_reason
            FROM student_skill_evidence
            WHERE student_id=? AND board_id=?
            ORDER BY recorded_at DESC, id DESC LIMIT 250
            """, (rs,row)->new Evidence(rs.getObject("id",UUID.class),
                rs.getString("skill_id"),rs.getString("source_type"),rs.getString("source_ref"),
                rs.getString("autonomy"),rs.getString("explanation"),rs.getString("source_excerpt"),
                rs.getTimestamp("observed_at").toInstant(),rs.getTimestamp("recorded_at").toInstant(),
                (Integer)rs.getObject("mastery_after"),rs.getObject("supersedes_id",UUID.class),
                rs.getString("correction_reason")),studentId,boardId);
    }

    @Transactional
    public Recorded record(String boardId,UUID studentId,Observation input,AuthenticatedUser caller) {
        mastery.get(boardId,studentId,caller);
        if(input==null)throw bad("Нужно наблюдение");
        String skillId=bounded(input.skillId(),128,"skillId");
        String kind=bounded(input.sourceType(),24,"sourceType");
        String ref=bounded(input.sourceRef(),256,"sourceRef");
        String autonomy=bounded(input.autonomy(),24,"autonomy");
        String description=bounded(input.explanation(),1200,"explanation");
        String key=bounded(input.idempotencyKey(),128,"idempotencyKey");
        if(!Set.of("LESSON","HOMEWORK","TEST","TEACHER_OBSERVATION").contains(kind))throw bad("Неверный тип источника");
        if(!Set.of("FIRST_TRY","INDEPENDENT","HINTED","AFTER_EXPLANATION","NOT_YET","UNKNOWN").contains(autonomy))throw bad("Неверный уровень самостоятельности");
        if(!key.matches("[A-Za-z0-9_.:-]{8,128}"))throw bad("Неверный idempotencyKey");
        String excerpt=input.sourceExcerpt()==null||input.sourceExcerpt().isBlank()?null:bounded(input.sourceExcerpt(),1200,"sourceExcerpt");
        String correction=input.correctionReason()==null||input.correctionReason().isBlank()?null:bounded(input.correctionReason(),400,"correctionReason");
        if(input.observedAt()==null||input.observedAt().isAfter(Instant.now().plusSeconds(3600)))
            throw bad("Укажите действительную дату наблюдения");
        if(input.masteryAfter()!=null&&(input.masteryAfter()<0||input.masteryAfter()>100))
            throw bad("Оценка навыка должна быть 0-100");
        boolean exists=boards.get(boardId).data().nodes().stream()
            .anyMatch(n->"skill".equals(n.kind())&&!n.archived()&&n.id().equals(skillId));
        if(!exists)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Активный навык не найден");

        // Retries are safe; never overwrite a previous observation with altered data.
        var previous=jdbc.query("""
            SELECT id,skill_id,source_type,source_ref,autonomy,explanation,source_excerpt,
                   observed_at,recorded_at,mastery_after,supersedes_id,correction_reason
            FROM student_skill_evidence
            WHERE student_id=? AND board_id=? AND idempotency_key=?
            """,(rs,row)->new Evidence(rs.getObject("id",UUID.class),rs.getString("skill_id"),
                rs.getString("source_type"),rs.getString("source_ref"),rs.getString("autonomy"),
                rs.getString("explanation"),rs.getString("source_excerpt"),
                rs.getTimestamp("observed_at").toInstant(),rs.getTimestamp("recorded_at").toInstant(),
                (Integer)rs.getObject("mastery_after"),rs.getObject("supersedes_id",UUID.class),
                rs.getString("correction_reason")),studentId,boardId,key);
        if(!previous.isEmpty()){
            Evidence past=previous.get(0);
            if(!Objects.equals(past.skillId(),skillId)||!Objects.equals(past.sourceType(),kind)
                ||!Objects.equals(past.sourceRef(),ref)||!Objects.equals(past.autonomy(),autonomy)
                ||!Objects.equals(past.explanation(),description)||!Objects.equals(past.sourceExcerpt(),excerpt)
                ||!Objects.equals(past.observedAt(),input.observedAt())
                ||!Objects.equals(past.masteryAfter(),input.masteryAfter())
                ||!Objects.equals(past.supersedesId(),input.supersedesId())
                ||!Objects.equals(past.correctionReason(),correction))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Этот ключ уже использован для другого наблюдения");
            return new Recorded(past,mastery.get(boardId,studentId,caller),true);
        }
        if(input.supersedesId()!=null){
            if(correction==null)throw bad("Укажите причину исправления");
            Integer original=jdbc.query("""
                SELECT COUNT(*) FROM student_skill_evidence WHERE id=? AND student_id=? AND board_id=? AND skill_id=?
                """,rs->rs.next()?rs.getInt(1):0,input.supersedesId(),studentId,boardId,skillId);
            if(original==null||original!=1)throw bad("Исправляемое наблюдение не найдено для этого навыка");
        }else if(correction!=null)throw bad("Исправление должно ссылаться на исходное наблюдение");
        UUID id=UUID.randomUUID();
        int changed=jdbc.update("""
            INSERT INTO student_skill_evidence
                (id,student_id,board_id,skill_id,source_type,source_ref,autonomy,explanation,
                source_excerpt,observed_at,recorded_by,mastery_after,supersedes_id,correction_reason,idempotency_key)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(student_id,board_id,idempotency_key) DO NOTHING
            """,id,studentId,boardId,skillId,kind,ref,autonomy,description,excerpt,
            java.sql.Timestamp.from(input.observedAt()),caller.id(),input.masteryAfter(),
            input.supersedesId(),correction,key);
        if(changed!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Повторите чтение наблюдений");
        if(input.masteryAfter()!=null)mastery.update(boardId,studentId,skillId,input.masteryAfter(),caller);
        // Corrective observations are appended, not destructive edits.
        Evidence saved=list(boardId,studentId,caller).stream().filter(row->row.id().equals(id))
            .findFirst().orElseThrow(()->new IllegalStateException("Наблюдение не сохранилось"));
        return new Recorded(saved,mastery.get(boardId,studentId,caller),false);
    }

    private static String bounded(String text,int max,String field){
        if(text==null||text.isBlank()||text.length()>max)throw bad("Укажите "+field+" (до "+max+" символов)");
        return text.trim();
    }
    private static ResponseStatusException bad(String reason){
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,reason);
    }
}
