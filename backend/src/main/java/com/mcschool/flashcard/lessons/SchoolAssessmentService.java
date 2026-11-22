package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** School tests are date-only informational markers, not actual lesson bookings. */
@Service
public class SchoolAssessmentService {
    public record Assessment(UUID id,UUID teacherId,UUID studentId,String studentName,
                             LocalDate examDate,String kind,String title,List<String> topics,
                             String notes,String sourceType,String sourceRef,String sourceExcerpt,
                             String confirmationStatus,long revision,Instant createdAt,Instant updatedAt) {}
    public record Create(UUID studentId,LocalDate examDate,String kind,String title,
                         List<String> topics,String notes,String sourceType,String sourceRef,
                         String sourceExcerpt,String confirmationStatus,String idempotencyKey) {}
    public record Update(long expectedRevision,LocalDate examDate,String kind,String title,
                         List<String> topics,String notes,String sourceType,String sourceRef,
                         String sourceExcerpt,String confirmationStatus) {}

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final ObjectMapper json;

    public SchoolAssessmentService(JdbcTemplate jdbc,UserRepository users,ObjectMapper json) {
        this.jdbc=jdbc;this.users=users;this.json=json;
    }

    private void requireTeacher(AuthenticatedUser caller) {
        if(caller==null||caller.id()==null||caller.role()!=Role.TEACHER)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Нужен доступ преподавателя");
    }

    private void requirePupil(UUID studentId, UUID teacherId) {
        if(studentId==null)throw bad("Укажите ученика");
        User student=users.findById(studentId).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Ученик не найден"));
        if(student.getRole()!=Role.STUDENT||student.isArchived()||student.getStatus()!=UserStatus.ACTIVE
                ||student.getTeacher()==null||!teacherId.equals(student.getTeacher().getId()))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Ученик не найден у этого преподавателя");
    }

    private Assessment mapped(java.sql.ResultSet rs,int row) throws java.sql.SQLException {
        String text=rs.getString("topics_json");
        List<String> topics=Arrays.asList(json.readValue(text,String[].class));
        return new Assessment(rs.getObject("id",UUID.class),rs.getObject("teacher_id",UUID.class),
            rs.getObject("student_id",UUID.class),rs.getString("student_name"),
            rs.getDate("exam_date").toLocalDate(),rs.getString("kind"),rs.getString("title"),topics,
            rs.getString("notes"),rs.getString("source_type"),rs.getString("source_ref"),
            rs.getString("source_excerpt"),rs.getString("confirmation_status"),rs.getLong("revision"),
            rs.getTimestamp("created_at").toInstant(),rs.getTimestamp("updated_at").toInstant());
    }
    private static final String SELECT = """
        SELECT a.id,a.teacher_id,a.student_id,s.full_name AS student_name,
            a.exam_date,a.kind,a.title,a.topics::text AS topics_json,a.notes,
            a.source_type,a.source_ref,a.source_excerpt,a.confirmation_status,
            a.revision,a.created_at,a.updated_at
        FROM school_assessments a JOIN users s ON s.id=a.student_id
        """;

    @Transactional(readOnly=true)
    public List<Assessment> list(AuthenticatedUser caller) {
        requireTeacher(caller);
        return jdbc.query(SELECT+" WHERE a.teacher_id=? ORDER BY a.exam_date,a.title,a.id",
                this::mapped,caller.id());
    }

    @Transactional(readOnly=true)
    public Assessment get(AuthenticatedUser caller,UUID id) {
        requireTeacher(caller);
        return jdbc.query(SELECT+" WHERE a.id=? AND a.teacher_id=?",this::mapped,id,caller.id())
            .stream().findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Событие не найдено"));
    }

    @Transactional
    public Assessment create(AuthenticatedUser caller,Create data) {
        requireTeacher(caller);
        if(data==null)throw bad("Укажите контрольную");
        requirePupil(data.studentId(),caller.id());
        check(data.examDate(),data.kind(),data.title(),data.topics(),data.notes(),
            data.sourceType(),data.sourceRef(),data.sourceExcerpt(),data.confirmationStatus());
        String key=required(data.idempotencyKey(),128,"idempotencyKey");
        if(!key.matches("[A-Za-z0-9_.:-]{8,128}"))throw bad("Недопустимый ключ запроса");
        var replay=jdbc.query(SELECT+" WHERE a.teacher_id=? AND a.idempotency_key=?",
            this::mapped,caller.id(),key);
        if(!replay.isEmpty()){
            Assessment old=replay.get(0);
            if(!Objects.equals(old.studentId(),data.studentId())||
                    !Objects.equals(old.examDate(),data.examDate())||
                    !Objects.equals(old.kind(),data.kind())||
                    !Objects.equals(old.title(),data.title().trim())||
                    !Objects.equals(old.topics(),cleanTopics(data.topics()))||
                    !Objects.equals(old.notes(),nullable(data.notes()))||
                    !Objects.equals(old.sourceType(),data.sourceType())||
                    !Objects.equals(old.sourceRef(),nullable(data.sourceRef()))||
                    !Objects.equals(old.sourceExcerpt(),nullable(data.sourceExcerpt()))||
                    !Objects.equals(old.confirmationStatus(),data.confirmationStatus()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Ключ запроса уже использован для другого события");
            return old;
        }
        UUID id=UUID.randomUUID();
        int written=jdbc.update("""
            INSERT INTO school_assessments(id,teacher_id,student_id,exam_date,kind,title,topics,
                notes,source_type,source_ref,source_excerpt,confirmation_status,idempotency_key,
                created_by,updated_by)
            VALUES (?,?,?,?,?,?,CAST(? AS jsonb),?,?,?,?,?,?,?,?)
            ON CONFLICT(teacher_id,idempotency_key) DO NOTHING
            """,id,caller.id(),data.studentId(),data.examDate(),data.kind(),data.title().trim(),
                json.writeValueAsString(cleanTopics(data.topics())),nullable(data.notes()),
                data.sourceType(),nullable(data.sourceRef()),nullable(data.sourceExcerpt()),
                data.confirmationStatus(),key,caller.id(),caller.id());
        if(written==0)throw new ResponseStatusException(HttpStatus.CONFLICT,"Данные изменились. Проверьте событие перед повторением.");
        return get(caller,id);
    }

    @Transactional
    public Assessment update(AuthenticatedUser caller,UUID id,Update data) {
        requireTeacher(caller);
        if(data==null||data.expectedRevision()<1)throw bad("Укажите актуальную версию события");
        Assessment old=get(caller,id);
        if(old.revision()!=data.expectedRevision())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Событие изменено. Обновите календарь");
        check(data.examDate(),data.kind(),data.title(),data.topics(),data.notes(),
            data.sourceType(),data.sourceRef(),data.sourceExcerpt(),data.confirmationStatus());
        // Audit the old snapshot without deleting the student's source attribution.
        jdbc.update("""
            INSERT INTO school_assessment_changes(assessment_id,old_revision,old_state,updated_by)
            SELECT id,revision,to_jsonb(school_assessments),? FROM school_assessments
            WHERE id=? AND teacher_id=? AND revision=?
            """,caller.id(),id,caller.id(),data.expectedRevision());
        int count=jdbc.update("""
            UPDATE school_assessments
            SET exam_date=?,kind=?,title=?,topics=CAST(? AS jsonb),notes=?,
                source_type=?,source_ref=?,source_excerpt=?,confirmation_status=?,
                revision=revision+1,updated_at=now(),updated_by=?
            WHERE id=? AND teacher_id=? AND revision=?
            """,data.examDate(),data.kind(),data.title().trim(),
                json.writeValueAsString(cleanTopics(data.topics())),nullable(data.notes()),
                data.sourceType(),nullable(data.sourceRef()),nullable(data.sourceExcerpt()),
                data.confirmationStatus(),caller.id(),id,caller.id(),data.expectedRevision());
        if(count!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Событие изменилось. Обновите календарь");
        return get(caller,id);
    }

    private void check(LocalDate date,String kind,String title,List<String> topics,
                       String notes,String sourceType,String sourceRef,String excerpt,String status) {
        if(date==null||date.getYear()<2020||date.getYear()>2100)throw bad("Некорректная дата контрольной");
        if(!Set.of("KLASSENARBEIT","TEST","EXAM","QUIZ","OTHER").contains(kind))throw bad("Неизвестный вид проверки");
        required(title,180,"Название");
        if(topics==null||topics.size()>24)throw bad("Можно указать до 24 тем");
        cleanTopics(topics);
        optional(notes,2500,"Заметка");
        if(!Set.of("TRANSCRIPT","STUDENT_REPORTED","TEACHER_NOTE","VOICE_NOTE","SCHOOL_DOCUMENT").contains(sourceType))
            throw bad("Укажите происхождение сведений");
        optional(sourceRef,300,"Ссылка на источник");
        optional(excerpt,1200,"Цитата");
        if(!Set.of("REPORTED","SCHOOL_CONFIRMED").contains(status))
            throw bad("Некорректный статус подтверждения");
        if("TRANSCRIPT".equals(sourceType)&&(nullable(sourceRef)==null||nullable(excerpt)==null))
            throw bad("Для транскрипции укажите точный урок и цитату");
        if("SCHOOL_CONFIRMED".equals(status)&&!"SCHOOL_DOCUMENT".equals(sourceType))
            throw bad("Школьное подтверждение требует источника SCHOOL_DOCUMENT");
    }
    private List<String> cleanTopics(List<String> list) {
        List<String> out=new ArrayList<>();
        for(String t:list){String cleaned=required(t,150,"Тема");if(!out.contains(cleaned))out.add(cleaned);}
        return out;
    }
    private static String required(String s,int length,String label) {
        if(s==null||s.isBlank()||s.trim().length()>length)throw bad(label+": необходимо от 1 до "+length+" символов");
        return s.trim();
    }
    private static void optional(String s,int length,String label){
        if(s!=null&&s.length()>length)throw bad(label+" слишком длинная");
    }
    private static String nullable(String s){return s==null||s.isBlank()?null:s.trim();}
    private static ResponseStatusException bad(String reason){return new ResponseStatusException(HttpStatus.BAD_REQUEST,reason);}
}
