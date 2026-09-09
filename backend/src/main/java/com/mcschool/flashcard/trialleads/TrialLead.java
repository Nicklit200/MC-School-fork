package com.mcschool.flashcard.trialleads;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "trial_leads")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TrialLead {

    @Id
    private UUID id;

    @Column(name = "tracking_token", nullable = false, unique = true)
    private UUID trackingToken;

    @Column(nullable = false, length = 40)
    private String phone;

    @Column(length = 80)
    private String grade;

    @Column(name = "school_type", length = 120)
    private String schoolType;

    @Column(length = 120)
    private String subject;

    @Column(length = 500)
    private String goal;

    @Column(length = 500)
    private String priority;

    @Column(name = "teacher_id", length = 100)
    private String teacherId;

    @Column(name = "teacher_name", length = 160)
    private String teacherName;

    @Column(length = 500)
    private String source;

    @Column(nullable = false, length = 40)
    private String status;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    private TrialLead(String phone, String source) {
        this.id = UUID.randomUUID();
        this.trackingToken = UUID.randomUUID();
        this.phone = phone.strip();
        this.source = source == null ? "" : source.strip();
        this.status = "NEW";
    }

    public static TrialLead create(String phone, String source) {
        return new TrialLead(phone, source);
    }

    public void applyAnswers(String grade, String schoolType, String subject, String goal, String priority) {
        this.grade = grade;
        this.schoolType = schoolType;
        this.subject = subject;
        this.goal = goal;
        this.priority = priority;
        if (!"CALENDAR_OPENED".equals(this.status)) {
            this.status = "FORM_COMPLETED";
        }
    }

    public void markTeacherSelected(String teacherId, String teacherName) {
        this.teacherId = teacherId;
        this.teacherName = teacherName;
        if (!"CALENDAR_OPENED".equals(this.status)) {
            this.status = "TEACHER_SELECTED";
        }
    }

    public void markCalendarOpened(String teacherId, String teacherName) {
        this.teacherId = teacherId;
        this.teacherName = teacherName;
        this.status = "CALENDAR_OPENED";
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
