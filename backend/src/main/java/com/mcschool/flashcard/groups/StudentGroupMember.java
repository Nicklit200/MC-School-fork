package com.mcschool.flashcard.groups;

import com.mcschool.flashcard.users.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

@Entity
@Table(name = "student_group_members", uniqueConstraints = {
        @UniqueConstraint(name = "uq_student_group_member", columnNames = {"group_id", "student_id"})
})
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StudentGroupMember {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private StudentGroup group;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private StudentGroupMember(StudentGroup group, User student) {
        this.id = UUID.randomUUID();
        this.group = group;
        this.student = student;
    }

    public static StudentGroupMember create(StudentGroup group, User student) {
        return new StudentGroupMember(group, student);
    }
}
