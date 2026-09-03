package com.mcschool.flashcard.users;

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
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {

    @Id
    private UUID id;

    @Column(name = "full_name", nullable = false, length = 100)
    private String fullName;

    @Column(length = 255)
    private String email;

    @Column(name = "password_hash", length = 100)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Role role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "preferred_language", nullable = false, length = 5)
    private Language preferredLanguage;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "teacher_id")
    private User teacher;

    @Column(name = "invitation_token", length = 100)
    private String invitationToken;

    @Column(name = "invitation_expires_at")
    private Instant invitationExpiresAt;

    @Column(name = "google_drive_folder_url", length = 1000)
    private String googleDriveFolderUrl;

    @Column(nullable = false)
    private boolean archived;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private Long version;

    private User(String fullName, String email, Role role) {
        this.id = UUID.randomUUID();
        this.fullName = fullName;
        this.email = email;
        this.role = role;
        this.preferredLanguage = Language.RU;
    }

    public void changeLanguage(Language language) {
        this.preferredLanguage = language;
    }

    public void changeGoogleDriveFolderUrl(String googleDriveFolderUrl) {
        if (googleDriveFolderUrl == null || googleDriveFolderUrl.isBlank()) {
            this.googleDriveFolderUrl = null;
            return;
        }
        this.googleDriveFolderUrl = googleDriveFolderUrl.trim();
    }

    public void assignEmail(String email) {
        this.email = email;
    }

    public static User bootstrapAdmin(String fullName, String email, String passwordHash) {
        User user = new User(fullName, email, Role.ADMIN);
        user.passwordHash = passwordHash;
        user.status = UserStatus.ACTIVE;
        return user;
    }

    public static User invitedTeacher(String fullName, String email,
                                      String invitationToken, Instant invitationExpiresAt) {
        User user = new User(fullName, email, Role.TEACHER);
        user.status = UserStatus.INVITED;
        user.invitationToken = invitationToken;
        user.invitationExpiresAt = invitationExpiresAt;
        return user;
    }

    public static User invitedStudent(String fullName, String email, User teacher,
                                      String invitationToken, Instant invitationExpiresAt) {
        User user = new User(fullName, email, Role.STUDENT);
        user.status = UserStatus.INVITED;
        user.teacher = teacher;
        user.invitationToken = invitationToken;
        user.invitationExpiresAt = invitationExpiresAt;
        return user;
    }

    public void restoreAsInvitedStudent(String fullName, User teacher,
                                        String invitationToken, Instant invitationExpiresAt) {
        if (this.role != Role.STUDENT || !this.archived) {
            throw new IllegalStateException("Only archived student accounts can be restored");
        }
        this.fullName = fullName;
        this.teacher = teacher;
        this.passwordHash = null;
        this.status = UserStatus.INVITED;
        this.invitationToken = invitationToken;
        this.invitationExpiresAt = invitationExpiresAt;
        this.archived = false;
    }

    public void activate(String passwordHash) {
        if (this.status != UserStatus.INVITED) {
            throw new IllegalStateException("Only INVITED accounts can be activated");
        }
        if (this.archived) {
            throw new IllegalStateException("Archived accounts cannot be activated");
        }
        this.passwordHash = passwordHash;
        this.status = UserStatus.ACTIVE;
        this.invitationToken = null;
        this.invitationExpiresAt = null;
    }

    public void archive() {
        this.archived = true;
        this.passwordHash = null;
        this.invitationToken = null;
        this.invitationExpiresAt = null;
    }

    public boolean isInvitationExpired(Instant now) {
        return invitationExpiresAt != null && now.isAfter(invitationExpiresAt);
    }
}
