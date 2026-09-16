package com.mcschool.flashcard.parents;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ParentTeacherMessageService {

    private static final long MAX_IMAGE_BYTES = 10L * 1024L * 1024L;
    private static final int MAX_MESSAGE_LENGTH = 4000;

    private final ParentTeacherMessageRepository messageRepository;
    private final UserRepository userRepository;

    public ParentTeacherMessageService(ParentTeacherMessageRepository messageRepository,
                                       UserRepository userRepository) {
        this.messageRepository = messageRepository;
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public List<MessageResponse> list(AuthenticatedUser caller, UUID studentId) {
        requireAccessibleStudent(caller, studentId);
        return messageRepository.findAllByStudentIdOrderByCreatedAtAsc(studentId).stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public MessageResponse send(AuthenticatedUser caller,
                                UUID studentId,
                                String text,
                                MultipartFile image) {
        User student = requireAccessibleStudent(caller, studentId);
        User sender = userRepository.findById(caller.id())
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Sender not found"));

        String normalizedText = text == null ? "" : text.trim();
        if (normalizedText.length() > MAX_MESSAGE_LENGTH) {
            throw new IllegalArgumentException("Message is too long");
        }

        ImageUpload upload = readImage(image);
        if (normalizedText.isBlank() && upload == null) {
            throw new IllegalArgumentException("Message text or image is required");
        }

        ParentTeacherMessage message = ParentTeacherMessage.create(
                student,
                sender,
                normalizedText,
                upload == null ? null : upload.bytes(),
                upload == null ? null : upload.filename(),
                upload == null ? null : upload.mimeType());
        messageRepository.save(message);
        return toResponse(message);
    }

    @Transactional(readOnly = true)
    public ImageResponse image(AuthenticatedUser caller, UUID messageId) {
        ParentTeacherMessage message = messageRepository.findById(messageId)
                .orElseThrow(() -> new ResourceNotFoundException("Message not found"));
        requireAccessibleStudent(caller, message.getStudent().getId());
        if (!message.hasImage()) throw new ResourceNotFoundException("Image not found");
        return new ImageResponse(
                message.getImageData(),
                message.getImageFilename() == null ? "attachment" : message.getImageFilename(),
                message.getImageMimeType() == null ? "application/octet-stream" : message.getImageMimeType());
    }

    private User requireAccessibleStudent(AuthenticatedUser caller, UUID studentId) {
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));

        boolean allowed = switch (caller.role()) {
            case PARENT -> student.getParent() != null && student.getParent().getId().equals(caller.id());
            case TEACHER -> student.getTeacher() != null && student.getTeacher().getId().equals(caller.id());
            case ADMIN -> true;
            default -> false;
        };
        if (!allowed) throw new ResourceNotFoundException("Student not found");
        return student;
    }

    private ImageUpload readImage(MultipartFile image) {
        if (image == null || image.isEmpty()) return null;
        if (image.getSize() > MAX_IMAGE_BYTES) throw new IllegalArgumentException("Image is too large");

        String mime = image.getContentType() == null ? "" : image.getContentType().toLowerCase(Locale.ROOT);
        if (!List.of("image/jpeg", "image/png", "image/webp").contains(mime)) {
            throw new IllegalArgumentException("Only JPG, PNG and WEBP images are supported");
        }

        String filename = image.getOriginalFilename() == null ? "photo" : image.getOriginalFilename().trim();
        if (filename.isBlank()) filename = "photo";
        if (filename.length() > 255) filename = filename.substring(filename.length() - 255);
        try {
            return new ImageUpload(image.getBytes(), filename, mime);
        } catch (IOException e) {
            throw new IllegalArgumentException("Could not read image", e);
        }
    }

    private MessageResponse toResponse(ParentTeacherMessage message) {
        User sender = message.getSender();
        return new MessageResponse(
                message.getId(),
                message.getStudent().getId(),
                sender.getId(),
                sender.getFullName(),
                sender.getRole(),
                message.getMessageText(),
                message.hasImage(),
                message.getImageFilename(),
                message.getCreatedAt());
    }

    private record ImageUpload(byte[] bytes, String filename, String mimeType) {}

    public record MessageResponse(
            UUID id,
            UUID studentId,
            UUID senderId,
            String senderName,
            Role senderRole,
            String text,
            boolean hasImage,
            String imageFilename,
            Instant createdAt
    ) {}

    public record ImageResponse(byte[] bytes, String filename, String mimeType) {}
}
