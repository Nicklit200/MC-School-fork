package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkDeadlinePolicy;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.homeworks.HomeworkStats;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistory;
import com.mcschool.flashcard.reviewhistory.DailyReviewHistoryRepository;
import com.mcschool.flashcard.study.SessionStatus;
import com.mcschool.flashcard.study.SessionType;
import com.mcschool.flashcard.study.StudySession;
import com.mcschool.flashcard.study.StudySessionItem;
import com.mcschool.flashcard.study.StudySessionItemRepository;
import com.mcschool.flashcard.study.StudySessionRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only analytics exposed to the Mindcrafti ChatGPT/MCP connector. */
@Service
public class McpAnalyticsService {

    private static final ZoneId SCHOOL_ZONE = HomeworkDeadlinePolicy.SCHOOL_ZONE;
    private static final int MAX_RANGE_DAYS = 366;

    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardRepository cardRepository;
    private final StudySessionRepository sessionRepository;
    private final StudySessionItemRepository itemRepository;
    private final DailyReviewHistoryRepository reviewHistoryRepository;

    public McpAnalyticsService(
            UserRepository userRepository,
            HomeworkRepository homeworkRepository,
            CardRepository cardRepository,
            StudySessionRepository sessionRepository,
            StudySessionItemRepository itemRepository,
            DailyReviewHistoryRepository reviewHistoryRepository) {
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.cardRepository = cardRepository;
        this.sessionRepository = sessionRepository;
        this.itemRepository = itemRepository;
        this.reviewHistoryRepository = reviewHistoryRepository;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listTeachers(User actor, boolean adminLike) {
        List<User> teachers;
        if (isAdminLike(actor, adminLike)) {
            teachers = userRepository.findAllByRoleOrderByFullNameAsc(Role.TEACHER).stream()
                    .filter(teacher -> !teacher.isArchived())
                    .toList();
        } else if (actor != null && actor.getRole() == Role.TEACHER && !actor.isArchived()) {
            teachers = List.of(actor);
        } else {
            throw new IllegalArgumentException("Teacher or admin access is required");
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (User teacher : teachers) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("teacherId", teacher.getId().toString());
            item.put("teacherName", teacher.getFullName());
            item.put("status", teacher.getStatus().name());
            item.put("studentCount", userRepository
                    .findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(teacher.getId(), Role.STUDENT)
                    .size());
            result.add(item);
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> findStudents(User actor, boolean adminLike, String query, String teacherId) {
        String normalizedQuery = normalize(query);
        List<User> students = accessibleStudents(actor, adminLike, teacherId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (User student : students) {
            User teacher = student.getTeacher();
            String haystack = normalize(String.join(" ",
                    student.getFullName() == null ? "" : student.getFullName(),
                    student.getEmail() == null ? "" : student.getEmail(),
                    student.getUsername() == null ? "" : student.getUsername(),
                    teacher == null || teacher.getFullName() == null ? "" : teacher.getFullName()));
            if (!normalizedQuery.isBlank() && !haystack.contains(normalizedQuery)) continue;
            result.add(studentIdentity(student));
        }
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> dailySummary(User actor, boolean adminLike, LocalDate date, String teacherId) {
        List<User> students = accessibleStudents(actor, adminLike, teacherId);
        List<Map<String, Object>> rows = new ArrayList<>();
        int withAssignedWork = 0;
        int withActivity = 0;
        int missingWork = 0;
        int totalErrors = 0;
        long totalStudySeconds = 0;

        for (User student : students) {
            Map<String, Object> row = studentDay(student, date);
            rows.add(row);
            if (Boolean.TRUE.equals(row.get("hasAssignedWork"))) withAssignedWork++;
            if (Boolean.TRUE.equals(row.get("hasActivity"))) withActivity++;
            if (Boolean.TRUE.equals(row.get("hasMissingWork"))) missingWork++;
            totalErrors += intValue(row.get("wrongFirstTry"));
            totalStudySeconds += longValue(row.get("cardStudySeconds"));
        }

        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("studentsVisible", students.size());
        totals.put("studentsWithAssignedWork", withAssignedWork);
        totals.put("studentsWithActivity", withActivity);
        totals.put("studentsWithMissingWork", missingWork);
        totals.put("wrongFirstTry", totalErrors);
        totals.put("cardStudySeconds", totalStudySeconds);
        totals.put("cardStudyMinutes", roundedMinutes(totalStudySeconds));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("date", date.toString());
        result.put("timezone", SCHOOL_ZONE.getId());
        result.put("totals", totals);
        result.put("students", rows);
        result.put("measurementLimitations", measurementLimitations());
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> studentActivity(
            User actor, boolean adminLike, UUID studentId, LocalDate fromDate, LocalDate toDate) {
        validateRange(fromDate, toDate);
        User student = requireAccessibleStudent(actor, adminLike, studentId);
        List<StudySession> sessions = completedSessions(studentId).stream()
                .filter(session -> between(localDate(session.getCompletedAt()), fromDate, toDate))
                .toList();
        List<Homework> homeworks = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(studentId);
        List<Homework> assigned = homeworks.stream()
                .filter(homework -> between(homework.getStartDate(), fromDate, toDate))
                .toList();
        List<Homework> pdfSubmissions = homeworks.stream()
                .filter(Homework::isSubmitted)
                .filter(homework -> between(localDate(homework.getSubmittedAt()), fromDate, toDate))
                .toList();
        List<DailyReviewHistory> reviewDays = reviewHistoryRepository.findAll().stream()
                .filter(history -> history.getStudent().getId().equals(studentId))
                .filter(history -> between(history.getDate(), fromDate, toDate))
                .sorted(Comparator.comparing(DailyReviewHistory::getDate))
                .toList();

        int totalSessionCards = sessions.stream().mapToInt(StudySession::getTotalCards).sum();
        int correctFirstTry = sessions.stream().mapToInt(StudySession::getCorrectFirstTry).sum();
        int wrongFirstTry = Math.max(0, totalSessionCards - correctFirstTry);
        long studySeconds = sessions.stream().mapToLong(this::durationSeconds).sum();
        long scheduledSessions = sessions.stream().filter(session -> session.getSessionType() == SessionType.SCHEDULED).count();
        long practiceSessions = sessions.stream().filter(session -> session.getSessionType() == SessionType.PRACTICE).count();
        long reviewCompleted = reviewDays.stream().filter(history -> "COMPLETED".equals(history.getStatus().name())).count();
        long reviewPartial = reviewDays.stream().filter(history -> "PARTIAL".equals(history.getStatus().name())).count();
        long reviewMissed = reviewDays.stream().filter(history -> "MISSED".equals(history.getStatus().name())).count();
        long pdfLate = pdfSubmissions.stream().filter(HomeworkDeadlinePolicy::wasSubmittedLate).count();

        List<Map<String, Object>> sessionRows = sessions.stream()
                .sorted(Comparator.comparing(StudySession::getCompletedAt))
                .map(this::sessionSummary)
                .toList();
        List<Map<String, Object>> errors = new ArrayList<>();
        for (StudySession session : sessions) {
            for (StudySessionItem item : itemRepository.findAllBySessionId(session.getId())) {
                if (item.isFirstTryClean()) continue;
                errors.add(answerRow(session, item));
            }
        }

        List<Map<String, Object>> days = new ArrayList<>();
        LocalDate cursor = fromDate;
        while (!cursor.isAfter(toDate)) {
            Map<String, Object> day = studentDay(student, cursor);
            if (Boolean.TRUE.equals(day.get("hasAssignedWork")) || Boolean.TRUE.equals(day.get("hasActivity"))) {
                days.add(day);
            }
            cursor = cursor.plusDays(1);
        }

        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("homeworkAssignments", assigned.size());
        totals.put("pdfSubmissions", pdfSubmissions.size());
        totals.put("pdfSubmittedLate", pdfLate);
        totals.put("completedCardSessions", sessions.size());
        totals.put("scheduledSessions", scheduledSessions);
        totals.put("practiceSessions", practiceSessions);
        totals.put("cardsInCompletedSessions", totalSessionCards);
        totals.put("correctFirstTry", correctFirstTry);
        totals.put("wrongFirstTry", wrongFirstTry);
        totals.put("firstTryAccuracyPercent", percent(correctFirstTry, totalSessionCards));
        totals.put("cardStudySeconds", studySeconds);
        totals.put("cardStudyMinutes", roundedMinutes(studySeconds));
        totals.put("reviewDaysCompleted", reviewCompleted);
        totals.put("reviewDaysPartial", reviewPartial);
        totals.put("reviewDaysMissed", reviewMissed);
        totals.put("currentCardsDue", cardRepository.countDueCards(studentId, LocalDate.now(SCHOOL_ZONE)));
        totals.put("currentTotalCards", cardRepository.countByStudentIdAndArchivedFalse(studentId));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", studentIdentity(student));
        result.put("fromDate", fromDate.toString());
        result.put("toDate", toDate.toString());
        result.put("timezone", SCHOOL_ZONE.getId());
        result.put("totals", totals);
        result.put("sessions", sessionRows);
        result.put("errors", errors);
        result.put("activeDays", days);
        result.put("measurementLimitations", measurementLimitations());
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> homeworkHistory(
            User actor, boolean adminLike, UUID studentId, LocalDate fromDate, LocalDate toDate) {
        validateRange(fromDate, toDate);
        User student = requireAccessibleStudent(actor, adminLike, studentId);
        List<Homework> homeworks = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(studentId).stream()
                .filter(homework -> between(homework.getStartDate(), fromDate, toDate))
                .sorted(Comparator.comparing(Homework::getStartDate).reversed().thenComparing(Homework::getCreatedAt).reversed())
                .toList();
        Map<UUID, HomeworkStats> stats = new HashMap<>();
        for (HomeworkStats value : homeworkRepository.statsByStudentId(studentId)) stats.put(value.homeworkId(), value);

        List<StudySession> allSessions = completedSessions(studentId);
        Map<UUID, List<StudySession>> sessionsByHomework = new HashMap<>();
        for (StudySession session : allSessions) {
            Set<UUID> homeworkIds = new HashSet<>();
            for (StudySessionItem item : itemRepository.findAllBySessionId(session.getId())) {
                if (item.getCard().getHomework() != null) homeworkIds.add(item.getCard().getHomework().getId());
            }
            for (UUID homeworkId : homeworkIds) sessionsByHomework
                    .computeIfAbsent(homeworkId, ignored -> new ArrayList<>())
                    .add(session);
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Homework homework : homeworks) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("homeworkId", homework.getId().toString());
            row.put("assignedDate", homework.getStartDate().toString());
            row.put("worksheetAssigned", homework.hasWorksheet());
            row.put("worksheetFilename", homework.getWorksheetFilename());
            row.put("worksheetSubmittedAt", instant(homework.getSubmittedAt()));
            row.put("worksheetSubmittedAtBerlin", zoned(homework.getSubmittedAt()));
            row.put("worksheetStatus", worksheetStatus(homework));
            HomeworkStats homeworkStats = stats.get(homework.getId());
            if (homeworkStats != null) {
                row.put("totalCards", homeworkStats.totalCards());
                row.put("cardsNotStarted", homeworkStats.notStarted());
                row.put("cardsInProgress", homeworkStats.inProgress());
                row.put("cardsLearned", homeworkStats.learned());
            } else {
                row.put("totalCards", 0L);
                row.put("cardsNotStarted", 0L);
                row.put("cardsInProgress", 0L);
                row.put("cardsLearned", 0L);
            }
            List<StudySession> linkedSessions = sessionsByHomework.getOrDefault(homework.getId(), List.of());
            List<String> sessionIds = linkedSessions.stream().map(session -> session.getId().toString()).toList();
            row.put("cardSessionIds", sessionIds);
            row.put("firstCardActivityAt", linkedSessions.stream()
                    .map(StudySession::getStartedAt)
                    .min(Comparator.naturalOrder()).map(Instant::toString).orElse(null));
            row.put("lastCardActivityAt", linkedSessions.stream()
                    .map(StudySession::getCompletedAt)
                    .filter(value -> value != null)
                    .max(Comparator.naturalOrder()).map(Instant::toString).orElse(null));
            long wrong = 0;
            long attempts = 0;
            for (StudySession session : linkedSessions) {
                for (StudySessionItem item : itemRepository.findAllBySessionId(session.getId())) {
                    if (!item.getCard().getHomework().getId().equals(homework.getId())) continue;
                    attempts++;
                    if (!item.isFirstTryClean()) wrong++;
                }
            }
            row.put("cardItemsSeenInCompletedSessions", attempts);
            row.put("wrongFirstTry", wrong);
            rows.add(row);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", studentIdentity(student));
        result.put("fromDate", fromDate.toString());
        result.put("toDate", toDate.toString());
        result.put("homeworks", rows);
        result.put("measurementLimitations", measurementLimitations());
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> cardSessionDetails(User actor, boolean adminLike, UUID sessionId) {
        StudySession session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Card session not found"));
        User student = requireAccessibleStudent(actor, adminLike, session.getStudent().getId());
        List<StudySessionItem> items = itemRepository.findAllBySessionId(sessionId).stream()
                .sorted(Comparator.comparingInt(StudySessionItem::getQueuePosition))
                .toList();
        List<Map<String, Object>> answers = items.stream().map(item -> answerRow(session, item)).toList();

        Map<String, Object> result = sessionSummary(session);
        result.put("student", studentIdentity(student));
        result.put("answers", answers);
        result.put("measurementLimitations", measurementLimitations());
        return result;
    }

    private Map<String, Object> studentDay(User student, LocalDate date) {
        List<Homework> allHomeworks = homeworkRepository.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(student.getId());
        List<Homework> assigned = allHomeworks.stream()
                .filter(homework -> date.equals(homework.getStartDate()))
                .toList();
        List<Homework> pdfSubmittedThatDay = allHomeworks.stream()
                .filter(Homework::isSubmitted)
                .filter(homework -> date.equals(localDate(homework.getSubmittedAt())))
                .toList();
        List<StudySession> sessions = completedSessions(student.getId()).stream()
                .filter(session -> date.equals(localDate(session.getCompletedAt())))
                .toList();

        int worksheetsAssigned = (int) assigned.stream().filter(Homework::hasWorksheet).count();
        int worksheetsSubmittedByEndOfDay = (int) assigned.stream()
                .filter(Homework::hasWorksheet)
                .filter(homework -> submittedByEndOfDay(homework, date))
                .count();
        int worksheetsMissing = Math.max(0, worksheetsAssigned - worksheetsSubmittedByEndOfDay);
        int cardsAssigned = assigned.stream()
                .mapToInt(homework -> cardRepository.findAllByHomeworkIdAndStudentIdAndArchivedFalseOrderByCreatedAtDesc(
                        homework.getId(), student.getId()).size())
                .sum();

        int sessionCards = sessions.stream().mapToInt(StudySession::getTotalCards).sum();
        int correctFirstTry = sessions.stream().mapToInt(StudySession::getCorrectFirstTry).sum();
        int wrongFirstTry = Math.max(0, sessionCards - correctFirstTry);
        long studySeconds = sessions.stream().mapToLong(this::durationSeconds).sum();
        long scheduledSessions = sessions.stream().filter(session -> session.getSessionType() == SessionType.SCHEDULED).count();
        long practiceSessions = sessions.stream().filter(session -> session.getSessionType() == SessionType.PRACTICE).count();

        DailyReviewHistory reviewHistory = reviewHistoryRepository.findByStudentIdAndDate(student.getId(), date).orElse(null);
        long dueCards;
        String reviewStatus;
        if (reviewHistory != null) {
            dueCards = reviewHistory.getDueCount();
            reviewStatus = reviewHistory.getStatus().name();
        } else if (date.equals(LocalDate.now(SCHOOL_ZONE))) {
            dueCards = cardRepository.countDueCards(student.getId(), date);
            reviewStatus = dueCards > 0 ? "PENDING" : "NONE";
        } else {
            dueCards = 0;
            reviewStatus = "NO_SNAPSHOT";
        }

        List<Map<String, Object>> errors = new ArrayList<>();
        for (StudySession session : sessions) {
            for (StudySessionItem item : itemRepository.findAllBySessionId(session.getId())) {
                if (!item.isFirstTryClean()) errors.add(answerRow(session, item));
            }
        }

        boolean reviewMissing = "MISSED".equals(reviewStatus) || "PARTIAL".equals(reviewStatus)
                || ("PENDING".equals(reviewStatus) && dueCards > 0);
        boolean hasAssignedWork = !assigned.isEmpty() || dueCards > 0;
        boolean hasActivity = !sessions.isEmpty() || !pdfSubmittedThatDay.isEmpty();
        boolean hasMissingWork = worksheetsMissing > 0 || reviewMissing;

        Map<String, Object> row = studentIdentity(student);
        row.put("hasAssignedWork", hasAssignedWork);
        row.put("hasActivity", hasActivity);
        row.put("hasMissingWork", hasMissingWork);
        row.put("homeworkAssignments", assigned.size());
        row.put("worksheetsAssigned", worksheetsAssigned);
        row.put("worksheetsSubmittedByEndOfDay", worksheetsSubmittedByEndOfDay);
        row.put("worksheetsMissingAtEndOfDay", worksheetsMissing);
        row.put("pdfSubmissionsThatDay", pdfSubmittedThatDay.size());
        row.put("cardsAssignedThatDay", cardsAssigned);
        row.put("cardsDueForReview", dueCards);
        row.put("dailyReviewStatus", reviewStatus);
        row.put("completedCardSessions", sessions.size());
        row.put("scheduledSessions", scheduledSessions);
        row.put("practiceSessions", practiceSessions);
        row.put("cardsInCompletedSessions", sessionCards);
        row.put("correctFirstTry", correctFirstTry);
        row.put("wrongFirstTry", wrongFirstTry);
        row.put("firstTryAccuracyPercent", percent(correctFirstTry, sessionCards));
        row.put("cardStudySeconds", studySeconds);
        row.put("cardStudyMinutes", roundedMinutes(studySeconds));
        row.put("errors", errors);
        row.put("sessionIds", sessions.stream().map(session -> session.getId().toString()).toList());
        row.put("pdfSubmissions", pdfSubmittedThatDay.stream().map(this::pdfSubmissionRow).toList());
        return row;
    }

    private Map<String, Object> sessionSummary(StudySession session) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("sessionId", session.getId().toString());
        row.put("type", session.getSessionType().name());
        row.put("status", session.getStatus().name());
        row.put("startedAt", instant(session.getStartedAt()));
        row.put("startedAtBerlin", zoned(session.getStartedAt()));
        row.put("completedAt", instant(session.getCompletedAt()));
        row.put("completedAtBerlin", zoned(session.getCompletedAt()));
        long durationSeconds = durationSeconds(session);
        row.put("durationSeconds", durationSeconds);
        row.put("durationMinutes", roundedMinutes(durationSeconds));
        row.put("totalCards", session.getTotalCards());
        row.put("correctFirstTry", session.getCorrectFirstTry());
        int wrong = Math.max(0, session.getTotalCards() - session.getCorrectFirstTry());
        row.put("wrongFirstTry", wrong);
        row.put("firstTryAccuracyPercent", percent(session.getCorrectFirstTry(), session.getTotalCards()));
        return row;
    }

    private Map<String, Object> answerRow(StudySession session, StudySessionItem item) {
        Card card = item.getCard();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("sessionId", session.getId().toString());
        row.put("sessionType", session.getSessionType().name());
        row.put("cardId", card.getId().toString());
        row.put("homeworkId", card.getHomework() == null ? null : card.getHomework().getId().toString());
        row.put("homeworkDate", card.getHomework() == null ? null : card.getHomework().getStartDate().toString());
        row.put("question", card.getQuestion());
        row.put("studentFirstAnswer", item.getFirstSelectedAnswer());
        row.put("correctAnswer", card.getCorrectAnswer());
        row.put("correctFirstTry", item.isFirstTryClean());
        row.put("hadWrongAttempt", item.isHadWrongAttempt());
        row.put("timeLimitSeconds", card.getTimeLimitSeconds());
        return row;
    }

    private Map<String, Object> pdfSubmissionRow(Homework homework) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("homeworkId", homework.getId().toString());
        row.put("assignedDate", homework.getStartDate().toString());
        row.put("filename", homework.getSubmittedFilename());
        row.put("submittedAt", instant(homework.getSubmittedAt()));
        row.put("submittedAtBerlin", zoned(homework.getSubmittedAt()));
        row.put("status", worksheetStatus(homework));
        return row;
    }

    private Map<String, Object> studentIdentity(User student) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("studentId", student.getId().toString());
        item.put("studentName", student.getFullName());
        item.put("studentStatus", student.getStatus().name());
        User teacher = student.getTeacher();
        item.put("teacherId", teacher == null ? null : teacher.getId().toString());
        item.put("teacherName", teacher == null ? null : teacher.getFullName());
        item.put("parentLinked", student.getParent() != null && !student.getParent().isArchived());
        item.put("parentName", student.getParent() == null ? null : student.getParent().getFullName());
        return item;
    }

    private List<User> accessibleStudents(User actor, boolean adminLike, String teacherId) {
        if (isAdminLike(actor, adminLike)) {
            if (teacherId != null && !teacherId.isBlank()) {
                UUID id = parseUuid(teacherId, "teacherId");
                User teacher = userRepository.findById(id)
                        .filter(user -> user.getRole() == Role.TEACHER)
                        .filter(user -> !user.isArchived())
                        .orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
                return userRepository.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(
                        teacher.getId(), Role.STUDENT);
            }
            return userRepository.findAllByRoleOrderByFullNameAsc(Role.STUDENT).stream()
                    .filter(student -> !student.isArchived())
                    .toList();
        }
        if (actor == null || actor.getRole() != Role.TEACHER || actor.isArchived()) {
            throw new IllegalArgumentException("Teacher or admin access is required");
        }
        if (teacherId != null && !teacherId.isBlank() && !actor.getId().equals(parseUuid(teacherId, "teacherId"))) {
            throw new IllegalArgumentException("Teachers can access only their own students");
        }
        return userRepository.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(actor.getId(), Role.STUDENT);
    }

    private User requireAccessibleStudent(User actor, boolean adminLike, UUID studentId) {
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new IllegalArgumentException("Student not found"));
        if (isAdminLike(actor, adminLike)) return student;
        if (actor == null || actor.getRole() != Role.TEACHER || student.getTeacher() == null
                || !actor.getId().equals(student.getTeacher().getId())) {
            throw new IllegalArgumentException("Teachers can access only their own students");
        }
        return student;
    }

    private List<StudySession> completedSessions(UUID studentId) {
        return sessionRepository.findAllByStudentIdAndStatusOrderByCompletedAtAsc(studentId, SessionStatus.COMPLETED);
    }

    private boolean isAdminLike(User actor, boolean adminLike) {
        return adminLike || (actor != null && actor.getRole() == Role.ADMIN);
    }

    private void validateRange(LocalDate fromDate, LocalDate toDate) {
        if (fromDate == null || toDate == null) throw new IllegalArgumentException("fromDate and toDate are required");
        if (toDate.isBefore(fromDate)) throw new IllegalArgumentException("toDate cannot be before fromDate");
        long days = Duration.between(fromDate.atStartOfDay(SCHOOL_ZONE), toDate.plusDays(1).atStartOfDay(SCHOOL_ZONE)).toDays();
        if (days > MAX_RANGE_DAYS) throw new IllegalArgumentException("Date range cannot exceed " + MAX_RANGE_DAYS + " days");
    }

    private boolean submittedByEndOfDay(Homework homework, LocalDate day) {
        if (!homework.isSubmitted() || homework.getSubmittedAt() == null) return false;
        Instant end = day.plusDays(1).atStartOfDay(SCHOOL_ZONE).toInstant();
        return homework.getSubmittedAt().isBefore(end);
    }

    private String worksheetStatus(Homework homework) {
        if (!homework.hasWorksheet()) return "NOT_ASSIGNED";
        if (!homework.isSubmitted()) return HomeworkDeadlinePolicy.isOverdue(homework) ? "MISSING" : "PENDING";
        return HomeworkDeadlinePolicy.wasSubmittedLate(homework) ? "SUBMITTED_LATE" : "SUBMITTED_ON_TIME";
    }

    private long durationSeconds(StudySession session) {
        if (session.getStartedAt() == null || session.getCompletedAt() == null) return 0L;
        return Math.max(0L, Duration.between(session.getStartedAt(), session.getCompletedAt()).toSeconds());
    }

    private LocalDate localDate(Instant value) {
        return value == null ? null : value.atZone(SCHOOL_ZONE).toLocalDate();
    }

    private boolean between(LocalDate value, LocalDate fromDate, LocalDate toDate) {
        return value != null && !value.isBefore(fromDate) && !value.isAfter(toDate);
    }

    private String instant(Instant value) {
        return value == null ? null : value.toString();
    }

    private String zoned(Instant value) {
        return value == null ? null : value.atZone(SCHOOL_ZONE).toString();
    }

    private double percent(long numerator, long denominator) {
        if (denominator <= 0) return 0.0;
        return Math.round((numerator * 1000.0 / denominator)) / 10.0;
    }

    private double roundedMinutes(long seconds) {
        return Math.round((seconds / 60.0) * 10.0) / 10.0;
    }

    private int intValue(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private long longValue(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private UUID parseUuid(String value, String field) {
        try {
            return UUID.fromString(value);
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException(field + " must be a UUID");
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private List<String> measurementLimitations() {
        return List.of(
                "Card session duration is exact from session start to session completion, but per-card answer time is not stored.",
                "PDF homework stores submission time but does not currently store when the student started working on the PDF.",
                "For past card-review obligations, daily_review_history is used when a snapshot exists; NO_SNAPSHOT means no historical due-card snapshot was stored for that day."
        );
    }
}
