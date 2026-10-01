package com.mcschool.flashcard.monthlyplans;

import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "monthly_plans")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MonthlyPlan {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private User teacher;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 20)
    private MonthlyPlanTargetType targetType;

    @Column(name = "target_id", nullable = false)
    private UUID targetId;

    @Column(name = "plan_month", nullable = false, length = 7)
    private String planMonth;

    @Column(name = "plan_json", nullable = false, columnDefinition = "text")
    private String planJson;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private MonthlyPlan(User teacher, MonthlyPlanTargetType targetType, UUID targetId, String planMonth, String planJson) {
        this.id = UUID.randomUUID();
        this.teacher = teacher;
        this.targetType = targetType;
        this.targetId = targetId;
        this.planMonth = planMonth;
        this.planJson = planJson;
    }

    public static MonthlyPlan create(User teacher, MonthlyPlanTargetType targetType, UUID targetId, String planMonth, String planJson) {
        return new MonthlyPlan(teacher, targetType, targetId, planMonth, planJson);
    }

    public void updatePlanJson(String planJson) {
        this.planJson = planJson;
    }
}
