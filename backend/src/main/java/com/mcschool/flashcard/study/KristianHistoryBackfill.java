package com.mcschool.flashcard.study;

import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * One-off safe backfill for Kristian's already completed card sessions.
 * Re-running is harmless because an existing Drive filename is skipped.
 */
@Component
public class KristianHistoryBackfill {

    private static final Logger log = LoggerFactory.getLogger(KristianHistoryBackfill.class);
    private static final DateTimeFormatter EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");

    private final UserRepository userRepository;
    private final StudySessionRepository sessionRepository;
    private final StudySessionItemRepository itemRepository;
    private final GoogleDriveService googleDriveService;
    private final ZoneId zone;

    public KristianHistoryBackfill(UserRepository userRepository,
                                   StudySessionRepository sessionRepository,
                                   StudySessionItemRepository itemRepository,
                                   GoogleDriveService googleDriveService,
                                   @Value("${app.notifications.review-reminders.zone}") String zone) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.itemRepository = itemRepository;
        this.googleDriveService = googleDriveService;
        this.zone = ZoneId.of(zone);
    }

    @EventListener(ApplicationReadyEvent.class)
    @Transactional(readOnly = true)
    public void backfill() {
        List<User> matches = userRepository.findAllByRoleOrderByFullNameAsc(Role.STUDENT).stream()
                .filter(user -> isKristian(user.getFullName()))
                .filter(user -> !user.isArchived())
                .toList();

        if (matches.isEmpty()) {
            log.info("Kristian Drive history backfill: no matching student found");
            return;
        }

        for (User student : matches) {
            String folderId = student.getGoogleDriveFolderUrl();
            if (folderId == null || folderId.isBlank()) {
                log.info("Kristian Drive history backfill skipped: no saved folder for studentId={}", student.getId());
                continue;
            }

            List<StudySession> sessions = sessionRepository.findAllByStudentIdAndStatusOrderByCompletedAtAsc(
                    student.getId(), SessionStatus.COMPLETED);
            int uploaded = 0;
            int skipped = 0;

            for (StudySession session : sessions) {
                if (session.getCompletedAt() == null) {
                    continue;
                }

                String timestamp = session.getCompletedAt().atZone(zone).format(EXPORT_TIME);
                String fileName = safeFileName(student.getFullName()) + "_" + timestamp + "_cards.csv";

                try {
                    if (googleDriveService.fileExists(folderId, fileName)) {
                        skipped++;
                        continue;
                    }

                    List<StudySessionItem> items = itemRepository.findAllBySessionId(session.getId()).stream()
                            .filter(item -> item.getFirstSelectedAnswer() != null)
                            .sorted(Comparator.comparing(StudySessionItem::getCreatedAt)
                                    .thenComparing(StudySessionItem::getId))
                            .toList();
                    int correct = (int) items.stream().filter(this::wasCorrectFirstTry).count();
                    int wrong = items.size() - correct;

                    StringBuilder csv = new StringBuilder("\uFEFF");
                    csv.append("Student;Session type;Total;Correct first try;Wrong first try\r\n");
                    csv.append(csvCell(student.getFullName())).append(';')
                            .append(csvCell(session.getSessionType().name())).append(';')
                            .append(items.size()).append(';')
                            .append(correct).append(';')
                            .append(wrong).append("\r\n\r\n");
                    csv.append("Question;Student answer;Correct answer;Result\r\n");

                    for (StudySessionItem item : items) {
                        Card card = item.getCard();
                        String selectedAnswer = item.getFirstSelectedAnswer();
                        boolean correctAnswer = card.getCorrectAnswer().equals(selectedAnswer);
                        csv.append(csvCell(card.getQuestion())).append(';')
                                .append(csvCell(selectedAnswer)).append(';')
                                .append(csvCell(card.getCorrectAnswer())).append(';')
                                .append(correctAnswer ? "CORRECT" : "WRONG")
                                .append("\r\n");
                    }

                    googleDriveService.uploadBytes(
                            folderId,
                            fileName,
                            "text/csv; charset=utf-8",
                            csv.toString().getBytes(StandardCharsets.UTF_8)
                    );
                    uploaded++;
                    log.info("Kristian Drive history backfill uploaded sessionId={} file={}", session.getId(), fileName);
                } catch (Exception ex) {
                    log.error("Kristian Drive history backfill failed for sessionId={} file={}",
                            session.getId(), fileName, ex);
                }
            }

            log.info("Kristian Drive history backfill finished: studentId={} sessions={} uploaded={} skippedExisting={}",
                    student.getId(), sessions.size(), uploaded, skipped);
        }
    }

    private boolean wasCorrectFirstTry(StudySessionItem item) {
        return item.getCard().getCorrectAnswer().equals(item.getFirstSelectedAnswer());
    }

    private boolean isKristian(String fullName) {
        if (fullName == null) {
            return false;
        }
        String normalized = fullName.trim().toLowerCase();
        return normalized.equals("kristian") || normalized.equals("кристиан");
    }

    private String safeFileName(String value) {
        if (value == null || value.isBlank()) {
            return "student";
        }
        String cleaned = value.trim().replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\s+", "_");
        return cleaned.isBlank() ? "student" : cleaned;
    }

    private String csvCell(String value) {
        if (value == null) {
            return "\"\"";
        }
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }
}
