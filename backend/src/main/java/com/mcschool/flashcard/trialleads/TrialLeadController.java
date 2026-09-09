package com.mcschool.flashcard.trialleads;

import com.mcschool.flashcard.notifications.PushSubscription;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1")
public class TrialLeadController {

    private static final Logger log = LoggerFactory.getLogger(TrialLeadController.class);
    private static final List<String> ALLOWED_STATUSES = List.of(
            "NEW",
            "GRADE_SELECTED",
            "SCHOOL_SELECTED",
            "SUBJECT_SELECTED",
            "GOAL_SELECTED",
            "PRIORITY_SELECTED",
            "FORM_COMPLETED",
            "TEACHER_SELECTED",
            "CALENDAR_OPENED",
            "BOOKED",
            "CONTACTED",
            "CONTRACT",
            "DECLINED"
    );

    private final JdbcTemplate jdbc;
    private final UserRepository userRepository;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;

    public TrialLeadController(
            JdbcTemplate jdbc,
            UserRepository userRepository,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService) {
        this.jdbc = jdbc;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
    }

    @PostMapping("/public/trial-leads")
    @ResponseStatus(HttpStatus.CREATED)
    public PublicLeadResponse create(@Valid @RequestBody CreateLeadRequest request) {
        UUID id = UUID.randomUUID();
        UUID token = UUID.randomUUID();
        String phone = request.phone().strip();
        jdbc.update("""
                INSERT INTO trial_leads (id, tracking_token, phone, source, status)
                VALUES (?, ?, ?, ?, 'NEW')
                """, id, token, phone, clean(request.source()));
        notifyAdminsAboutNewLead(phone);
        return new PublicLeadResponse(token, "NEW");
    }

    private void notifyAdminsAboutNewLead(String phone) {
        if (!webPushService.isConfigured()) return;
        try {
            for (var admin : userRepository.findAllByRoleOrderByFullNameAsc(Role.ADMIN)) {
                for (PushSubscription subscription : subscriptionRepository.findAllByUserId(admin.getId())) {
                    try {
                        webPushService.send(
                                subscription,
                                "Новая заявка Mindcrafti",
                                "Новый лид оставил номер: " + phone,
                                "/admin/leads");
                    } catch (Exception e) {
                        log.warn("Failed to send new trial lead push to admin {}", admin.getId(), e);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to dispatch new trial lead push notifications", e);
        }
    }

    @PatchMapping("/public/trial-leads/{token}")
    public PublicLeadResponse updatePublic(@PathVariable UUID token, @Valid @RequestBody UpdateLeadRequest request) {
        String event = request.event() == null ? "" : request.event().strip().toUpperCase();
        String status = switch (event) {
            case "GRADE_SELECTED" -> "GRADE_SELECTED";
            case "SCHOOL_SELECTED" -> "SCHOOL_SELECTED";
            case "SUBJECT_SELECTED" -> "SUBJECT_SELECTED";
            case "GOAL_SELECTED" -> "GOAL_SELECTED";
            case "PRIORITY_SELECTED" -> "PRIORITY_SELECTED";
            case "FORM_COMPLETED" -> "FORM_COMPLETED";
            case "TEACHER_SELECTED" -> "TEACHER_SELECTED";
            case "CALENDAR_OPENED" -> "CALENDAR_OPENED";
            default -> null;
        };

        int changed = jdbc.update("""
                UPDATE trial_leads SET
                    grade = COALESCE(?, grade),
                    school_type = COALESCE(?, school_type),
                    subject = COALESCE(?, subject),
                    goal = COALESCE(?, goal),
                    priority = COALESCE(?, priority),
                    teacher_id = COALESCE(?, teacher_id),
                    teacher_name = COALESCE(?, teacher_name),
                    status = COALESCE(?, status),
                    updated_at = CURRENT_TIMESTAMP
                WHERE tracking_token = ?
                """,
                cleanOrNull(request.grade()), cleanOrNull(request.schoolType()), cleanOrNull(request.subject()),
                cleanOrNull(request.goal()), cleanOrNull(request.priority()), cleanOrNull(request.teacherId()),
                cleanOrNull(request.teacherName()), status, token);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lead not found");
        String currentStatus = jdbc.queryForObject(
                "SELECT status FROM trial_leads WHERE tracking_token = ?", String.class, token);
        return new PublicLeadResponse(token, currentStatus);
    }

    @GetMapping("/admin/trial-leads")
    @PreAuthorize("hasRole('ADMIN')")
    public List<LeadResponse> list() {
        return jdbc.query("""
                SELECT id, tracking_token, phone, grade, school_type, subject, goal, priority,
                       teacher_id, teacher_name, source, status, created_at, updated_at
                FROM trial_leads
                ORDER BY created_at DESC
                """, (rs, rowNum) -> new LeadResponse(
                rs.getObject("id", UUID.class),
                rs.getObject("tracking_token", UUID.class),
                rs.getString("phone"),
                rs.getString("grade"),
                rs.getString("school_type"),
                rs.getString("subject"),
                rs.getString("goal"),
                rs.getString("priority"),
                rs.getString("teacher_id"),
                rs.getString("teacher_name"),
                rs.getString("source"),
                rs.getString("status"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at"))
        ));
    }

    @PatchMapping("/admin/trial-leads/{id}/status")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, String> setStatus(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        String status = body.getOrDefault("status", "").strip().toUpperCase();
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown status");
        }
        int changed = jdbc.update(
                "UPDATE trial_leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, id);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lead not found");
        return Map.of("status", status);
    }

    private static String clean(String value) {
        return value == null ? "" : value.strip();
    }

    private static String cleanOrNull(String value) {
        if (value == null) return null;
        String cleaned = value.strip();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record CreateLeadRequest(
            @NotBlank @Size(max = 40) String phone,
            @Size(max = 500) String source
    ) {}

    public record UpdateLeadRequest(
            @Size(max = 80) String grade,
            @Size(max = 120) String schoolType,
            @Size(max = 120) String subject,
            @Size(max = 500) String goal,
            @Size(max = 500) String priority,
            @Size(max = 100) String teacherId,
            @Size(max = 160) String teacherName,
            @Size(max = 40) String event
    ) {}

    public record PublicLeadResponse(UUID trackingToken, String status) {}

    public record LeadResponse(
            UUID id,
            UUID trackingToken,
            String phone,
            String grade,
            String schoolType,
            String subject,
            String goal,
            String priority,
            String teacherId,
            String teacherName,
            String source,
            String status,
            Instant createdAt,
            Instant updatedAt
    ) {}
}
