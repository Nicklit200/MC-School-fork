package com.mcschool.flashcard.lessons;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** A separate student document; never replaces the lesson's shared workbook. */
@Entity
@Table(name = "personal_lesson_workbooks", uniqueConstraints = @UniqueConstraint(
        name = "uq_personal_lesson_workbook", columnNames = {"teacher_id", "event_id", "student_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PersonalLessonWorkbook {
    @Id
    private UUID id;
    @Column(name = "teacher_id", nullable = false)
    private UUID teacherId;
    @Column(name = "event_id", nullable = false, length = 255)
    private String eventId;
    @Column(name = "student_id", nullable = false)
    private UUID studentId;
    @Column(nullable = false, length = 255)
    private String filename;
    @Column(name = "workbook_pdf", nullable = false, columnDefinition = "bytea")
    private byte[] workbookPdf;
    @Version
    @Column(nullable = false)
    private Long version;

    public static PersonalLessonWorkbook create(UUID teacherId, String eventId, UUID studentId) {
        PersonalLessonWorkbook workbook = new PersonalLessonWorkbook();
        workbook.id = UUID.randomUUID();
        workbook.teacherId = teacherId;
        workbook.eventId = eventId;
        workbook.studentId = studentId;
        return workbook;
    }

    public void attach(String filename, byte[] pdf) {
        this.filename = filename;
        this.workbookPdf = pdf;
    }

    public long documentVersion() {
        return version == null ? 1L : version + 1L;
    }
}
