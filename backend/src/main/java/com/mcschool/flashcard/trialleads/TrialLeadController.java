package com.mcschool.flashcard.trialleads;

import com.mcschool.flashcard.notifications.PushSubscription;
import com.mcschool.flashcard.notifications.PushSubscriptionRepository;
import com.mcschool.flashcard.notifications.WebPushService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
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
            "QUALIFIED_LEAD",
            "CONTRACT",
            "NO_RESPONSE",
            "DECLINED"
    );

    private final JdbcTemplate jdbc;
    private final UserRepository userRepository;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;
    private final MetaFunnelService metaFunnelService;

    public TrialLeadController(
            JdbcTemplate jdbc,
            UserRepository userRepository,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService,
            MetaFunnelService metaFunnelService) {
        this.jdbc = jdbc;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
        this.metaFunnelService = metaFunnelService;
    }

    @PostMapping("/public/trial-leads")
    @ResponseStatus(HttpStatus.CREATED)
    public PublicLeadResponse create(@Valid @RequestBody CreateLeadRequest request, HttpServletRequest httpRequest) {
        String phone = request.phone().strip();
        String source = clean(request.source());
        String clientId = cleanOrNull(request.clientId());

        if (clientId != null) {
            PublicLeadResponse existing = findByClientId(clientId);
            if (existing != null) {
                syncLeadByClientId(clientId, request);
                saveAttribution(clientId, null, request.email(), request.fbp(), request.fbc(),
                        request.eventSourceUrl(), request.marketingConsent(), httpRequest);
                return findByClientId(clientId);
            }
        }

        UUID id = UUID.randomUUID();
        UUID token = UUID.randomUUID();
        try {
            String initialStatus = initialStatus(request);
            jdbc.update("""
                    INSERT INTO trial_leads (
                        id, tracking_token, phone, grade, school_type, subject, goal, priority,
                        source, status, client_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    id,
                    token,
                    phone,
                    cleanOrNull(request.grade()),
                    cleanOrNull(request.schoolType()),
                    cleanOrNull(request.subject()),
                    cleanOrNull(request.goal()),
                    cleanOrNull(request.priority()),
                    source,
                    initialStatus,
                    clientId);
        } catch (DuplicateKeyException e) {
            if (clientId != null) {
                PublicLeadResponse existing = findByClientId(clientId);
                if (existing != null) {
                    saveAttribution(clientId, null, request.email(), request.fbp(), request.fbc(),
                            request.eventSourceUrl(), request.marketingConsent(), httpRequest);
                    return existing;
                }
            }
            throw e;
        }

        saveAttribution(null, token, request.email(), request.fbp(), request.fbc(),
                request.eventSourceUrl(), request.marketingConsent(), httpRequest);
        // Enqueue the browser-deduplicated Meta Lead without delaying or blocking CRM capture.
        // Only consented leads enter the CAPI sending queue; otherwise they are suppressed.
        metaFunnelService.recordLead(id, token);
        notifyAdminsAboutNewLead(phone);
        return new PublicLeadResponse(token, "NEW");
    }

    private void syncLeadByClientId(String clientId, CreateLeadRequest request) {
        jdbc.update("""
                UPDATE trial_leads SET
                    phone = COALESCE(?, phone),
                    grade = COALESCE(?, grade),
                    school_type = COALESCE(?, school_type),
                    subject = COALESCE(?, subject),
                    goal = COALESCE(?, goal),
                    priority = COALESCE(?, priority),
                    source = COALESCE(?, source),
                    status = CASE
                        WHEN status IN ('BOOKED', 'CONTACTED', 'QUALIFIED_LEAD', 'CONTRACT', 'NO_RESPONSE', 'DECLINED') THEN status
                        WHEN CAST(? AS VARCHAR) IS NOT NULL THEN 'FORM_COMPLETED'
                        WHEN CAST(? AS VARCHAR) IS NOT NULL THEN 'GOAL_SELECTED'
                        WHEN CAST(? AS VARCHAR) IS NOT NULL THEN 'GRADE_SELECTED'
                        ELSE status
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE client_id = ?
                """,
                cleanOrNull(request.phone()),
                cleanOrNull(request.grade()),
                cleanOrNull(request.schoolType()),
                cleanOrNull(request.subject()),
                cleanOrNull(request.goal()),
                cleanOrNull(request.priority()),
                cleanOrNull(request.source()),
                cleanOrNull(request.priority()),
                cleanOrNull(request.goal()),
                cleanOrNull(request.grade()),
                clientId);
    }

    private static String initialStatus(CreateLeadRequest request) {
        if (cleanOrNull(request.priority()) != null) return "FORM_COMPLETED";
        if (cleanOrNull(request.goal()) != null) return "GOAL_SELECTED";
        if (cleanOrNull(request.grade()) != null) return "GRADE_SELECTED";
        return "NEW";
    }

    private PublicLeadResponse findByClientId(String clientId) {
        List<PublicLeadResponse> matches = jdbc.query("""
                SELECT tracking_token, status
                FROM trial_leads
                WHERE client_id = ?
                LIMIT 1
                """, (rs, rowNum) -> new PublicLeadResponse(
                rs.getObject("tracking_token", UUID.class),
                rs.getString("status")
        ), clientId);
        return matches.isEmpty() ? null : matches.get(0);
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
    public PublicLeadResponse updatePublic(@PathVariable UUID token, @Valid @RequestBody UpdateLeadRequest request,
            HttpServletRequest httpRequest) {
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
                    status = CASE
                        WHEN status IN ('BOOKED', 'CONTACTED', 'QUALIFIED_LEAD', 'CONTRACT', 'NO_RESPONSE', 'DECLINED') THEN status
                        ELSE COALESCE(?, status)
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE tracking_token = ?
                """,
                cleanOrNull(request.grade()), cleanOrNull(request.schoolType()), cleanOrNull(request.subject()),
                cleanOrNull(request.goal()), cleanOrNull(request.priority()), cleanOrNull(request.teacherId()),
                cleanOrNull(request.teacherName()), status, token);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lead not found");
        saveAttribution(null, token, request.email(), request.fbp(), request.fbc(),
                request.eventSourceUrl(), request.marketingConsent(), httpRequest);
        String currentStatus = jdbc.queryForObject(
                "SELECT status FROM trial_leads WHERE tracking_token = ?", String.class, token);
        return new PublicLeadResponse(token, currentStatus);
    }

    @GetMapping("/admin/trial-leads")
    @PreAuthorize("hasRole('ADMIN')")
    public List<LeadResponse> list() {
        return jdbc.query("""
                SELECT id, tracking_token, phone, grade, school_type, subject, goal, priority,
                       teacher_id, teacher_name, source, status, created_at, updated_at,
                       meta_schedule_sent_at, meta_qualified_lead_sent_at, meta_purchase_sent_at
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
                instant(rs.getTimestamp("updated_at")),
                instant(rs.getTimestamp("meta_schedule_sent_at")),
                instant(rs.getTimestamp("meta_qualified_lead_sent_at")),
                instant(rs.getTimestamp("meta_purchase_sent_at"))
        ));
    }

    @PatchMapping("/admin/trial-leads/{id}/status")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, String> setStatus(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        String status = clean(body.get("status")).toUpperCase(java.util.Locale.ROOT);
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown status");
        }
        // The outbox and status commit together; the worker contacts Meta only after commit.
        int changed = metaFunnelService.updateLeadStatus(id, status);
        if (changed == 0) {
            Integer exists = jdbc.queryForObject("SELECT COUNT(*) FROM trial_leads WHERE id = ?", Integer.class, id);
            if (exists == null || exists == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lead not found");
        }
        return Map.of("status", status);
    }

    @DeleteMapping("/admin/trial-leads/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        int changed = jdbc.update("DELETE FROM trial_leads WHERE id = ?", id);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lead not found");
    }

    private void saveAttribution(String clientId, UUID token, String email, String fbp, String fbc,
            String eventSourceUrl, Boolean marketingConsent, HttpServletRequest httpRequest) {
        boolean consented = Boolean.TRUE.equals(marketingConsent);
        // Keep the original visitor's identifiers; later CRM actions never substitute the admin's browser.
        jdbc.update("""
                UPDATE trial_leads SET
                    email = COALESCE(email, ?),
                    meta_fbp = COALESCE(meta_fbp, ?),
                    meta_fbc = COALESCE(meta_fbc, ?),
                    meta_event_source_url = COALESCE(meta_event_source_url, ?),
                    meta_client_ip = COALESCE(meta_client_ip, ?),
                    meta_user_agent = COALESCE(meta_user_agent, ?),
                    meta_marketing_consent = COALESCE(?, meta_marketing_consent)
                WHERE client_id = ? OR tracking_token = ?
                """, cleanOrNull(email),
                consented ? metaIdentifier(fbp, false) : null,
                consented ? metaIdentifier(fbc, true) : null,
                consented ? eventSourceUrl(eventSourceUrl) : null,
                consented ? SiteVisitController.clientIp(httpRequest) : null,
                consented && httpRequest != null ? limited(httpRequest.getHeader("User-Agent"), 1000) : null,
                marketingConsent, clientId, token);
    }

    static String metaIdentifier(String value, boolean click) {
        String cleaned = cleanOrNull(value);
        if (cleaned == null) return null;
        String suffix = click ? "[^\\s\\p{Cntrl}]+" : "[0-9]+";
        return cleaned.matches("fb\\.[0-9]+\\.[0-9]{13}\\." + suffix) ? cleaned : null;
    }

    static String eventSourceUrl(String value) {
        if (value == null) return null;
        try {
            URI uri = URI.create(value.strip());
            if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null) return null;
            // URLs are attribution context only. Strip queries/fragments that may contain contact data.
            String sanitized = new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), uri.getPath(), null, null).toASCIIString();
            return sanitized.length() <= 2000 ? sanitized : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String limited(String value, int maximum) {
        String cleaned = cleanOrNull(value);
        return cleaned == null ? null : cleaned.substring(0, Math.min(cleaned.length(), maximum));
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
            @Size(max = 500) String source,
            @Size(max = 80) String clientId,
            @Size(max = 80) String grade,
            @Size(max = 120) String schoolType,
            @Size(max = 120) String subject,
            @Size(max = 500) String goal,
            @Size(max = 500) String priority,
            @Email @Size(max = 320) String email,
            @Size(max = 500) String fbp,
            @Size(max = 500) String fbc,
            @Size(max = 2000) String eventSourceUrl,
            Boolean marketingConsent
    ) {}

    public record UpdateLeadRequest(
            @Size(max = 80) String grade,
            @Size(max = 120) String schoolType,
            @Size(max = 120) String subject,
            @Size(max = 500) String goal,
            @Size(max = 500) String priority,
            @Size(max = 100) String teacherId,
            @Size(max = 160) String teacherName,
            @Size(max = 40) String event,
            @Email @Size(max = 320) String email,
            @Size(max = 500) String fbp,
            @Size(max = 500) String fbc,
            @Size(max = 2000) String eventSourceUrl,
            Boolean marketingConsent
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
            Instant updatedAt,
            Instant metaScheduleSentAt,
            Instant metaQualifiedLeadSentAt,
            Instant metaPurchaseSentAt
    ) {}
}
