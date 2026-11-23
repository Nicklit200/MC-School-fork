package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The teacher can see progress without exposing transcripts, prompts or student PDFs. */
@RestController
@RequestMapping("/api/v1/online-classes/{classId}/skill-review")
@PreAuthorize("hasRole('TEACHER')")
public class PostLessonSkillReviewController {
    private final PostLessonSkillReviewService review;

    public PostLessonSkillReviewController(PostLessonSkillReviewService review) {
        this.review = review;
    }

    @GetMapping
    public Map<String,Object> status(@AuthenticationPrincipal AuthenticatedUser teacher,
                                     @PathVariable UUID classId) {
        return review.status(teacher,classId);
    }
}
