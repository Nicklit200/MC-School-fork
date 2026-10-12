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
@Table(name = "story_template_master")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StoryTemplateMaster {

    @Id
    private Short id;

    @Column(length = 255)
    private String filename;

    @Column(name = "pptx_data", columnDefinition = "bytea")
    private byte[] pptxData;

    @Column(name = "sha256", length = 64)
    private String sha256;

    @Version
    @Column(nullable = false)
    private Long version;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public boolean isConfigured() {
        return pptxData != null && pptxData.length > 0;
    }

    public void replace(String filename, byte[] bytes, String digest) {
        this.filename = filename;
        this.pptxData = bytes.clone();
        this.sha256 = digest;
    }
}
