package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDetail;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class StudentLessonHistoryService {

    private final UserRepository userRepository;
    private final LessonHistoryRepository historyRepository;
    private final LessonPreparationRepository preparationRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final JdbcTemplate jdbc;

    public StudentLessonHistoryService(
            UserRepository userRepository,
            LessonHistoryRepository historyRepository,
            LessonPreparationRepository preparationRepository,
            StudentGroupMemberRepository groupMemberRepository,
            JdbcTemplate jdbc) {
        this.userRepository = userRepository;
        this.historyRepository = historyRepository;
        this.preparationRepository = preparationRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<StudentLessonHistoryItem> list(AuthenticatedUser caller, UUID studentId) {
        requireAssignedStudent(caller, studentId);
        Map<UUID, Instant> groupMembershipCreatedAt = groupMemberships(studentId);
        List<LessonHistoryEntry> candidates = new ArrayList<>();
        candidates.addAll(historyRepository.findAllByStudentIdAndDeletedAtIsNullOrderByStartsAtDesc(studentId));
        candidates.addAll(historyRepository.findAllByParticipantStudentIdsContainingAndDeletedAtIsNullOrderByStartsAtDesc(
                studentId.toString()));
        for (UUID groupId : groupMembershipCreatedAt.keySet()) {
            candidates.addAll(historyRepository.findAllByGroupIdAndDeletedAtIsNullOrderByStartsAtDesc(groupId));
        }

        Map<String, LessonHistoryEntry> unique = new LinkedHashMap<>();
        for (LessonHistoryEntry entry : candidates) {
            UUID ownerId = entry.getTeacher().getId();
            if (ownerId.equals(caller.id()) || !belongsToStudent(entry, studentId, groupMembershipCreatedAt)) {
                continue;
            }
            unique.putIfAbsent(ownerId + ":" + entry.getEventId(), entry);
        }

        return unique.values().stream()
                .sorted(Comparator.comparing(LessonHistoryEntry::getStartsAt).reversed())
                .map(this::toItem)
                .toList();
    }

    @Transactional(readOnly = true)
    public StudentLessonHistoryDetail detail(
            AuthenticatedUser caller, UUID studentId, UUID sourceTeacherId, String eventId) {
        requireAssignedStudent(caller, studentId);
        LessonHistoryEntry entry = requireAccessibleEntry(studentId, sourceTeacherId, eventId);
        LessonPreparation preparation = preparationRepository.findByTeacherIdAndEventId(sourceTeacherId, eventId)
                .orElse(null);
        return new StudentLessonHistoryDetail(
                sourceTeacherId,
                entry.getTeacher().getFullName(),
                entry.getEventId(),
                entry.getTitle(),
                entry.getGroupName(),
                entry.getStartsAt(),
                entry.getEndsAt(),
                preparation == null ? null : preparation.getHomeworkNotes(),
                preparation == null ? null : preparation.getDifficulties(),
                preparation == null ? null : preparation.getLessonPlan(),
                preparation == null ? null : preparation.getCoveredMaterial(),
                preparation == null || preparation.hasTranscriptPdf() ? null : preparation.getTranscriptText(),
                preparation != null && preparation.hasWorkbook(),
                preparation == null ? null : preparation.getWorkbookFilename(),
                preparation != null && preparation.hasAnswers(),
                preparation == null ? null : preparation.getAnswersFilename(),
                preparation != null && preparation.hasTranscript(),
                preparation == null ? null : preparation.getTranscriptFilename()
        );
    }

    @Transactional(readOnly = true)
    public PdfFile document(
            AuthenticatedUser caller, UUID studentId, UUID sourceTeacherId, String eventId, String kind) {
        requireAssignedStudent(caller, studentId);
        requireAccessibleEntry(studentId, sourceTeacherId, eventId);
        LessonPreparation preparation = preparationRepository.findByTeacherIdAndEventId(sourceTeacherId, eventId)
                .orElse(null);
        if (preparation == null) return null;
        return switch (kind) {
            case "workbook" -> preparation.hasWorkbook()
                    ? new PdfFile(safeDefault(preparation.getWorkbookFilename(), "lesson-workbook.pdf"),
                            preparation.getWorkbookPdf())
                    : null;
            case "answers" -> preparation.hasAnswers()
                    ? new PdfFile(safeDefault(preparation.getAnswersFilename(), "lesson-answers.pdf"),
                            preparation.getAnswersPdf())
                    : null;
            case "transcript" -> preparation.hasTranscriptPdf()
                    ? new PdfFile(safeDefault(preparation.getTranscriptFilename(), "lesson-transcript.pdf"),
                            preparation.getTranscriptPdf())
                    : null;
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown lesson document type");
        };
    }

    @Transactional(readOnly = true)
    public List<com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDocument> completedDocuments(
            AuthenticatedUser caller, UUID studentId, UUID sourceTeacherId, String eventId) {
        requireAssignedStudent(caller, studentId);
        requireAccessibleEntry(studentId, sourceTeacherId, eventId);
        String personalBoard = "personal-" + studentId;
        String manualPersonalBoard = "manual-personal-" + studentId;
        return jdbc.query("""
                SELECT id, board_id, filename, updated_at
                FROM completed_lesson_documents
                WHERE teacher_id = ? AND event_id = ?
                  AND (board_id IN ('board-1', 'manual-shared') OR board_id IN (?, ?))
                ORDER BY updated_at DESC
                """,
                (rs, rowNum) -> new com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDocument(
                        rs.getObject("id", UUID.class), rs.getString("board_id"), rs.getString("filename"),
                        rs.getTimestamp("updated_at").toInstant().toString()),
                sourceTeacherId, eventId, personalBoard, manualPersonalBoard);
    }

    @Transactional(readOnly = true)
    public PdfFile completedDocument(
            AuthenticatedUser caller, UUID studentId, UUID sourceTeacherId, String eventId, UUID documentId) {
        requireAssignedStudent(caller, studentId);
        requireAccessibleEntry(studentId, sourceTeacherId, eventId);
        String personalBoard = "personal-" + studentId;
        String manualPersonalBoard = "manual-personal-" + studentId;
        return jdbc.query("""
                SELECT filename, pdf
                FROM completed_lesson_documents
                WHERE id = ? AND teacher_id = ? AND event_id = ?
                  AND (board_id IN ('board-1', 'manual-shared') OR board_id IN (?, ?))
                """, rs -> {
                    if (!rs.next()) return null;
                    return new PdfFile(safeDefault(rs.getString("filename"), "completed-lesson.pdf"), rs.getBytes("pdf"));
                }, documentId, sourceTeacherId, eventId, personalBoard, manualPersonalBoard);
    }

    private StudentLessonHistoryItem toItem(LessonHistoryEntry entry) {
        LessonPreparation preparation = preparationRepository.findByTeacherIdAndEventId(
                entry.getTeacher().getId(), entry.getEventId()).orElse(null);
        return new StudentLessonHistoryItem(
                entry.getTeacher().getId(),
                entry.getTeacher().getFullName(),
                entry.getEventId(),
                entry.getTitle(),
                entry.getGroupName(),
                entry.getStartsAt(),
                entry.getEndsAt(),
                preparation != null && preparation.hasWorkbook(),
                preparation != null && preparation.hasAnswers(),
                preparation != null && preparation.hasTranscript()
        );
    }

    private LessonHistoryEntry requireAccessibleEntry(UUID studentId, UUID sourceTeacherId, String eventId) {
        Map<UUID, Instant> memberships = groupMemberships(studentId);
        return historyRepository.findByTeacherIdAndEventId(sourceTeacherId, eventId)
                .filter(item -> item.getDeletedAt() == null)
                .filter(item -> belongsToStudent(item, studentId, memberships))
                .orElseThrow(() -> new ResourceNotFoundException("Lesson history not found"));
    }

    private User requireAssignedStudent(AuthenticatedUser caller, UUID studentId) {
        if (caller == null || caller.role() != Role.TEACHER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Teacher account is required");
        }
        return userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(caller.id()))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
    }

    private Map<UUID, Instant> groupMemberships(UUID studentId) {
        Map<UUID, Instant> result = new LinkedHashMap<>();
        for (StudentGroupMember member : groupMemberRepository.findAllByStudentIdOrderByCreatedAtAsc(studentId)) {
            UUID groupId = member.getGroup().getId();
            Instant createdAt = member.getCreatedAt();
            if (createdAt != null) result.merge(groupId, createdAt,
                    (first, second) -> first.isBefore(second) ? first : second);
        }
        return result;
    }

    private boolean belongsToStudent(
            LessonHistoryEntry entry, UUID studentId, Map<UUID, Instant> groupMembershipCreatedAt) {
        if (studentId.equals(entry.getStudentId())) return true;
        String participantIds = entry.getParticipantStudentIds();
        if (participantIds != null && !participantIds.isBlank()) {
            for (String participantId : participantIds.split(",")) {
                if (studentId.toString().equals(participantId.trim())) return true;
            }
            return false;
        }
        if (entry.getGroupId() == null) return false;
        Instant joinedAt = groupMembershipCreatedAt.get(entry.getGroupId());
        return joinedAt != null && !joinedAt.isAfter(entry.getStartsAt());
    }

    private String safeDefault(String filename, String fallback) {
        return filename == null || filename.isBlank() ? fallback : filename;
    }

    public record PdfFile(String filename, byte[] bytes) {}
}
