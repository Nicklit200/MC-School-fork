package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Teacher-only endpoints. Never accept recipient IDs or PDFs from a browser. */
@RestController
@RequestMapping("/api/v1/online-classes/{classId}/post-lesson-homework")
@PreAuthorize("hasRole('TEACHER')")
public class PostLessonHomeworkController {
    private final PostLessonHomeworkJobService jobs;
    private final PostLessonHomeworkContentService content;
    private final OnlineClassAccessService access;

    public PostLessonHomeworkController(PostLessonHomeworkJobService jobs,
            PostLessonHomeworkContentService content,OnlineClassAccessService access){
        this.jobs=jobs;this.content=content;this.access=access;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,Object> queue(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId,@Valid @RequestBody PostLessonHomeworkJobService.Request request){
        return jobs.enqueue(teacher,classId,request);
    }

    @GetMapping
    public Map<String,Object> status(@AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId){
        return jobs.status(teacher,classId);
    }

    @PostMapping("/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,Object> retry(@AuthenticationPrincipal AuthenticatedUser teacher,@PathVariable UUID classId){
        return jobs.retry(teacher,classId);
    }

    @PostMapping(value="/transcribe",consumes="multipart/form-data")
    public Map<String,String> transcribe(@AuthenticationPrincipal AuthenticatedUser teacher,
            @PathVariable UUID classId,@RequestParam("audio") MultipartFile audio)throws Exception{
        access.requireHost(teacher,classId);
        return Map.of("text",content.transcribe(audio));
    }
}
