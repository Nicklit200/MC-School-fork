package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Only the owning teacher may generate or read these private reports. */
@RestController
@RequestMapping("/api/v1/online-classes/{classId}/completed-lesson-report")
@PreAuthorize("hasRole('TEACHER')")
public class CompletedLessonReportController {
    private final CompletedLessonReportService reports;
    public CompletedLessonReportController(CompletedLessonReportService reports){this.reports=reports;}

    @GetMapping("/recipients")
    public List<PostLessonSkillReviewService.ReportRecipient> recipients(
            @AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId){
        return reports.recipients(teacher,classId);
    }

    @GetMapping
    public ResponseEntity<List<CompletedLessonReportService.ReportJob>> history(
            @AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId,@RequestParam UUID studentId){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reports.history(teacher,classId,studentId));
    }

    @PostMapping
    public ResponseEntity<CompletedLessonReportService.ReportJob> enqueue(
            @AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId,
            @RequestBody CompletedLessonReportService.Request request){
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(reports.enqueue(teacher,classId,request));
    }

    @GetMapping("/{reportId}/pdf")
    public ResponseEntity<byte[]> pdf(@AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId,
            @PathVariable UUID reportId,@RequestParam UUID studentId,@RequestParam(defaultValue="RU") String language)throws IOException{
        var report=reports.report(teacher,classId,studentId,reportId);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"mindcrafti-lesson-report.pdf\"")
                .body(CompletedLessonReportPdf.render(report,"DE".equalsIgnoreCase(language)));
    }
}
