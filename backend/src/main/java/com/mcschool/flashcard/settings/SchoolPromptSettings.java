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

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    public void updatePrompts(String groupLessonPrompt, String individualLessonPrompt) {
        this.groupLessonPrompt = normalize(groupLessonPrompt);
        this.individualLessonPrompt = normalize(individualLessonPrompt);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
