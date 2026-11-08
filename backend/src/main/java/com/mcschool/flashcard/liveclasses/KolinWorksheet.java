package com.mcschool.flashcard.liveclasses;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Private durable result and confirmation receipt; never exposed to a pupil before append. */
@Entity
@Table(name = "kolin_worksheets")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class KolinWorksheet {
    @Id private UUID id;
    @Column(name="class_id", nullable=false) private UUID classId;
    @Column(name="teacher_id", nullable=false) private UUID teacherId;
    @Column(name="client_message_id", nullable=false) private UUID clientMessageId;
    @Column(name="parent_id") private UUID parentId;
    @Column(name="material_index") private Integer materialIndex;
    @Column(name="request_hash", nullable=false, length=64) private String requestHash;
    @Column(nullable=false, length=16) private String state;
    @Column(name="result_type", length=16) private String resultType;
    @Column(name="reply_text", columnDefinition="text") private String replyText;
    @Column(name="task_content", columnDefinition="text") private String taskContent;
    @Column(name="transcript_metadata", columnDefinition="text") private String transcriptMetadata;
    @Column(name="student_id") private UUID studentId;
    @Column(name="student_name", length=255) private String studentName;
    @Column(name="task_count") private int taskCount;
    @Column(name="page_count") private int pageCount;
    @Column(name="pdf_bytes", columnDefinition="bytea") private byte[] pdfBytes;
    @Column(name="preview_bytes", columnDefinition="bytea") private byte[] previewBytes;
    @Column(name="from_page") private Integer fromPage;
    @Column(name="to_page") private Integer toPage;
    @Column(name="created_at", nullable=false) private Instant createdAt;
    @Column(name="updated_at", nullable=false) private Instant updatedAt;
    @Column(name="attempt_id") private UUID attemptId;
    @Version private Long version;

    static KolinWorksheet material(KolinWorksheet parent,int index) {
        var row=new KolinWorksheet();
        row.id=UUID.randomUUID(); row.clientMessageId=row.id;
        row.classId=parent.classId; row.teacherId=parent.teacherId; row.requestHash=parent.requestHash;
        row.parentId=parent.id; row.materialIndex=index; row.createdAt=Instant.now();
        row.generating(); return row;
    }

    void generating() { state="GENERATING"; attemptId=UUID.randomUUID(); updatedAt=Instant.now(); }
    void failed() { state="FAILED"; updatedAt=Instant.now(); }
    void complete(String type, String text, String metadata, UUID pupilId, String pupilName,
                  int count, int pages, byte[] pdf, byte[] preview) {
        resultType=type; replyText=text; transcriptMetadata=metadata;
        studentId=pupilId; studentName=pupilName; taskCount=count; pageCount=pages;
        pdfBytes=pdf; previewBytes=preview; state="READY"; updatedAt=Instant.now();
    }
    void added(int first, int last) {
        fromPage=first; toPage=last; state="ADDED"; updatedAt=Instant.now();
    }
    void rememberTasks(String content) { taskContent=content; }
}
