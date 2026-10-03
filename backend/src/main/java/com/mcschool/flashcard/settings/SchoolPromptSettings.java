package com.mcschool.flashcard.settings;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "school_prompt_settings")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SchoolPromptSettings {

    @Id
    private Short id;

    @Column(name = "group_lesson_prompt", nullable = false, columnDefinition = "text")
    private String groupLessonPrompt;

    @Column(name = "individual_lesson_prompt", nullable = false, columnDefinition = "text")
    private String individualLessonPrompt;

    @Column(name = "diagnostic_lesson_prompt", nullable = false, columnDefinition = "text")
    private String diagnosticLessonPrompt;

    @Column(name = "error_correction_prompt", nullable = false, columnDefinition = "text")
    private String errorCorrectionPrompt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    public void updatePrompts(
            String groupLessonPrompt,
            String individualLessonPrompt,
            String diagnosticLessonPrompt,
            String errorCorrectionPrompt) {
        this.groupLessonPrompt = normalize(groupLessonPrompt);
        this.individualLessonPrompt = normalize(individualLessonPrompt);
        this.diagnosticLessonPrompt = normalize(diagnosticLessonPrompt);
        this.errorCorrectionPrompt = normalize(errorCorrectionPrompt);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
