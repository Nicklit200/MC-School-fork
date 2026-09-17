package com.mcschool.flashcard.parents;

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
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

@Entity
@Table(name = "parent_teacher_messages")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ParentTeacherMessage {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    @Column(name = "message_text", columnDefinition = "text")
    private String messageText;

    @Column(name = "image_data", columnDefinition = "bytea")
    private byte[] imageData;

    @Column(name = "image_filename", length = 255)
    private String imageFilename;

    @Column(name = "image_mime_type", length = 100)
    private String imageMimeType;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    @Column(nullable = false)
    private Long version;

    public static ParentTeacherMessage create(User student,
                                              User sender,
                                              String messageText,
                                              byte[] imageData,
                                              String imageFilename,
                                              String imageMimeType) {
        ParentTeacherMessage message = new ParentTeacherMessage();
        message.id = UUID.randomUUID();
        message.student = student;
        message.sender = sender;
        message.messageText = normalize(messageText);
        message.imageData = imageData;
        message.imageFilename = normalize(imageFilename);
        message.imageMimeType = normalize(imageMimeType);
        return message;
    }

    public boolean hasImage() {
        return imageData != null && imageData.length > 0;
    }

    private static String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
