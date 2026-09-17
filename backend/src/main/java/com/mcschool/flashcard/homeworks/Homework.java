package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/** A dated homework bucket for one student's cards and optional PDF worksheet. */
@Entity
@Table(name = "homeworks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Homework {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "worksheet_pdf", columnDefinition = "bytea")
    private byte[] worksheetPdf;

    @Column(name = "worksheet_filename", length = 255)
    private String worksheetFilename;

    @Column(name = "worksheet_page_count")
    private Integer worksheetPageCount;

    @Column(name = "submitted_pdf", columnDefinition = "bytea")
    private byte[] submittedPdf;

    @Column(name = "submitted_filename", length = 255)
    private String submittedFilename;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "parent_notified_at")
    private Instant parentNotifiedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private Homework(User student, LocalDate startDate) {
        this.id = UUID.randomUUID();
        this.student = student;
        this.startDate = startDate;
    }

    public static Homework create(User student, LocalDate startDate) {
        return new Homework(student, startDate);
    }

    public void attachWorksheet(String filename, byte[] pdf, int pageCount) {
        this.worksheetFilename = filename;
        this.worksheetPdf = pdf;
        this.worksheetPageCount = pageCount;
        this.submittedPdf = null;
        this.submittedFilename = null;
        this.submittedAt = null;
        this.parentNotifiedAt = null;
    }

    public void submitWorksheet(String filename, byte[] pdf, Instant submittedAt) {
        this.submittedFilename = filename;
        this.submittedPdf = pdf;
        this.submittedAt = submittedAt;
    }

    public void markParentNotified(Instant notifiedAt) {
        this.parentNotifiedAt = notifiedAt;
    }

    public boolean hasWorksheet() {
        return worksheetPdf != null && worksheetPdf.length > 0;
    }

    public boolean isSubmitted() {
        return submittedPdf != null && submittedPdf.length > 0 && submittedAt != null;
    }
}
