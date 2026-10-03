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
@Table(name = "school_brand_guide")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SchoolBrandGuide {

    @Id
    private Short id;

    @Column(name = "guide_text", nullable = false, columnDefinition = "text")
    private String guideText;

    @Column(name = "pdf_filename", length = 255)
    private String pdfFilename;

    @Column(name = "pdf_content_type", length = 100)
    private String pdfContentType;

    @Column(name = "pdf_data", columnDefinition = "bytea")
    private byte[] pdfData;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    public void updateGuideText(String guideText) {
        this.guideText = normalize(guideText);
    }

    public void attachPdf(String filename, byte[] pdf) {
        this.pdfFilename = normalizeFilename(filename);
        this.pdfContentType = "application/pdf";
        this.pdfData = pdf;
    }

    public boolean hasPdf() {
        return pdfData != null && pdfData.length > 0;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizeFilename(String value) {
        String filename = value == null ? "" : value.trim();
        if (filename.isBlank()) return "Mindcrafti_Brand_Guide.pdf";
        return filename;
    }
}
