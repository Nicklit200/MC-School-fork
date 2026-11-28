package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import java.sql.Date;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * The teacher's compact post-lesson homework review.
 * PDF bytes and private teacher solutions never appear in push notifications or public URLs.
 */
@RestController
@RequestMapping("/api/v1/online-classes/{classId}/post-lesson-homework/review")
@PreAuthorize("hasRole('TEACHER')")
public class PostLessonHomeworkReviewController {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final OnlineClassAccessService access;
    private final PostLessonHomeworkPilotAccess pilot;

    public PostLessonHomeworkReviewController(JdbcTemplate db,ObjectMapper json,
            OnlineClassAccessService access,PostLessonHomeworkPilotAccess pilot) {
        this.db=db;this.json=json;this.access=access;this.pilot=pilot;
    }

    private Map<String,Object> authorizedJob(AuthenticatedUser teacher,UUID classId) {
        pilot.require(teacher);
        access.requireHost(teacher,classId);
        return db.queryForList("""
            SELECT id,state,days,start_date,lesson_title,generated_files,expected_files
              FROM post_lesson_homework_jobs
             WHERE class_id=? AND teacher_id=?
            """,classId,teacher.id()).stream().findFirst()
                .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Homework job not found"));
    }

    @GetMapping
    public Map<String,Object> review(@AuthenticationPrincipal AuthenticatedUser teacher,
                                     @PathVariable UUID classId) {
        Map<String,Object> job=authorizedJob(teacher,classId);
        UUID jobId=(UUID)job.get("id");
        List<Map<String,Object>> days=new ArrayList<>();
        db.query("""
            SELECT d.student_id,u.full_name,d.day_number,d.assignment_date,d.review_json
              FROM post_lesson_homework_drafts d
              JOIN users u ON u.id=d.student_id
             WHERE d.job_id=?
             ORDER BY u.full_name,d.student_id,d.day_number
            """,rs->{
                Map<String,Object> entry=new LinkedHashMap<>();
                entry.put("studentId",rs.getObject("student_id",UUID.class).toString());
                entry.put("studentName",rs.getString("full_name"));
                entry.put("day",rs.getInt("day_number"));
                Date date=rs.getDate("assignment_date");
                entry.put("date",date.toLocalDate().toString());
                String raw=rs.getString("review_json");
                try {
                    entry.put("summary",raw==null ? null : json.readValue(raw,Map.class));
                } catch (RuntimeException exception) {
                    entry.put("summary",null);
                }
                days.add(entry);
            },jobId);
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("jobId",jobId.toString());
        result.put("state",job.get("state"));
        result.put("lessonTitle",job.get("lesson_title"));
        result.put("days",job.get("days"));
        result.put("startDate",job.get("start_date").toString());
        result.put("generatedFiles",job.get("generated_files"));
        result.put("expectedFiles",job.get("expected_files"));
        result.put("documents",days);
        return result;
    }

    @GetMapping(value="/pdf",produces="application/pdf")
    public ResponseEntity<byte[]> pdf(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId,@RequestParam UUID studentId,
            @RequestParam int day,@RequestParam String kind) {
        if(day<1||day>7||(!"student".equals(kind)&&!"teacher".equals(kind)))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid PDF selection");
        UUID jobId=(UUID)authorizedJob(teacher,classId).get("id");
        String field="student".equals(kind)?"student_pdf":"teacher_pdf";
        List<byte[]> found=db.query("SELECT "+field+" FROM post_lesson_homework_drafts"
                +" WHERE job_id=? AND student_id=? AND day_number=?",
                (rs,i)->rs.getBytes(1),jobId,studentId,day);
        if(found.isEmpty() || found.get(0)==null || found.get(0).length==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"PDF not generated");
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION,"inline; filename=\"Mindcrafti_Tag_"+day+"_"
                        +("student".equals(kind)?"Aufgaben":"Loesungen")+".pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(found.get(0));
    }
}
