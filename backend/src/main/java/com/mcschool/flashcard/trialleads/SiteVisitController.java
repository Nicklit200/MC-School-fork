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
import org.springframework.dao.DuplicateKeyException;
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

@RestController
@RequestMapping("/api/v1")
public class SiteVisitController {

    private static final Logger log = LoggerFactory.getLogger(SiteVisitController.class);

    private final JdbcTemplate jdbc;
    private final UserRepository userRepository;
    private final PushSubscriptionRepository subscriptionRepository;
    private final WebPushService webPushService;

    public SiteVisitController(
            JdbcTemplate jdbc,
            UserRepository userRepository,
            PushSubscriptionRepository subscriptionRepository,
            WebPushService webPushService) {
        this.jdbc = jdbc;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.webPushService = webPushService;
    }

    @PostMapping("/public/site-visits")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Boolean> visit(@Valid @RequestBody SiteVisitRequest request) {
        boolean inserted = persist(request);
        if (inserted) notifyAdmins(request);
        return Map.of("accepted", true);
    }

    @PatchMapping("/public/site-visits/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateProgress(@PathVariable String sessionId, @Valid @RequestBody FunnelProgressRequest request) {
        String event = clean(request.event(), 40);
        String funnelEvent = isFunnelEvent(event) ? event : null;
        String diagnosticEvent = isDiagnosticEvent(event) ? event : null;
        Integer scrollPercent = request.scrollPercent() == null
                ? null
                : Math.max(0, Math.min(100, request.scrollPercent()));
        Integer activeSeconds = request.activeSeconds() == null
                ? null
                : Math.max(0, Math.min(3600, request.activeSeconds()));

        jdbc.update("""
                UPDATE site_visits SET
                    funnel_stage = COALESCE(?, funnel_stage),
                    diagnostic_stage = COALESCE(?, diagnostic_stage),
                    path = COALESCE(?, path),
                    grade = COALESCE(?, grade),
                    goal = COALESCE(?, goal),
                    priority = COALESCE(?, priority),
                    trial_page_loaded_at = CASE
                        WHEN ? = 'TRIAL_PAGE_LOADED' THEN COALESCE(trial_page_loaded_at, CURRENT_TIMESTAMP)
                        ELSE trial_page_loaded_at
                    END,
                    grade_options_visible_at = CASE
                        WHEN ? = 'GRADE_OPTIONS_VISIBLE' THEN COALESCE(grade_options_visible_at, CURRENT_TIMESTAMP)
                        ELSE grade_options_visible_at
                    END,
                    first_interaction_at = CASE
                        WHEN ? = 'FIRST_INTERACTION' THEN COALESCE(first_interaction_at, CURRENT_TIMESTAMP)
                        ELSE first_interaction_at
                    END,
                    first_scroll_at = CASE
                        WHEN ? = 'SCROLLED' THEN COALESCE(first_scroll_at, CURRENT_TIMESTAMP)
                        ELSE first_scroll_at
                    END,
                    max_scroll_percent = CASE
                        WHEN ? IS NULL THEN max_scroll_percent
                        ELSE GREATEST(COALESCE(max_scroll_percent, 0), ?)
                    END,
                    max_active_seconds = CASE
                        WHEN ? IS NULL THEN max_active_seconds
                        ELSE GREATEST(COALESCE(max_active_seconds, 0), ?)
                    END,
                    first_interaction_label = COALESCE(first_interaction_label, ?),
                    client_error = COALESCE(?, client_error),
                    updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ?
                """,
                funnelEvent,
                diagnosticEvent,
                nullable(request.path(), 160),
                nullable(request.grade(), 80),
                nullable(request.goal(), 500),
                nullable(request.priority(), 500),
                event,
                event,
                event,
                event,
                scrollPercent,
                scrollPercent,
                activeSeconds,
                activeSeconds,
                nullable(request.interactionLabel(), 160),
                nullable(request.clientError(), 500),
                clean(sessionId, 80));
    }

    @GetMapping("/admin/site-visits")
    @PreAuthorize("hasRole('ADMIN')")
    public List<SiteVisitResponse> list() {
        return jdbc.query("""
                SELECT v.id, v.session_id, v.path, v.source, v.referrer, v.device_type, v.device_model,
                       v.os_name, v.os_version, v.browser_name, v.browser_version, v.screen_size,
                       v.viewport_size, v.language, v.user_agent, v.funnel_stage, v.diagnostic_stage,
                       v.grade, v.goal, v.priority, v.first_interaction_label,
                       v.max_scroll_percent, v.max_active_seconds, v.client_error,
                       v.trial_page_loaded_at, v.grade_options_visible_at, v.first_interaction_at, v.first_scroll_at,
                       v.created_at, v.updated_at,
                       l.phone AS lead_phone, l.status AS lead_status
                FROM site_visits v
                LEFT JOIN trial_leads l ON l.client_id = v.session_id
                ORDER BY v.created_at DESC
                LIMIT 200
                """, (rs, rowNum) -> new SiteVisitResponse(
                rs.getObject("id", UUID.class),
                rs.getString("session_id"),
                rs.getString("path"),
                rs.getString("source"),
                rs.getString("referrer"),
                rs.getString("device_type"),
                rs.getString("device_model"),
                rs.getString("os_name"),
                rs.getString("os_version"),
                rs.getString("browser_name"),
                rs.getString("browser_version"),
                rs.getString("screen_size"),
                rs.getString("viewport_size"),
                rs.getString("language"),
                rs.getString("user_agent"),
                rs.getString("funnel_stage"),
                rs.getString("diagnostic_stage"),
                rs.getString("grade"),
                rs.getString("goal"),
                rs.getString("priority"),
                rs.getString("first_interaction_label"),
                (Integer) rs.getObject("max_scroll_percent"),
                (Integer) rs.getObject("max_active_seconds"),
                rs.getString("client_error"),
                instant(rs.getTimestamp("trial_page_loaded_at")),
                instant(rs.getTimestamp("grade_options_visible_at")),
                instant(rs.getTimestamp("first_interaction_at")),
                instant(rs.getTimestamp("first_scroll_at")),
                rs.getString("lead_phone"),
                rs.getString("lead_status"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at"))
        ));
    }

    private boolean persist(SiteVisitRequest request) {
        try {
            jdbc.update("DELETE FROM site_visits WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'");
            jdbc.update("""
                    INSERT INTO site_visits (
                        id, session_id, path, source, referrer, device_type, device_model,
                        os_name, os_version, browser_name, browser_version, screen_size,
                        viewport_size, language, user_agent, funnel_stage
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VISIT')
                    """,
                    UUID.randomUUID(),
                    clean(request.sessionId(), 80),
                    nullable(request.path(), 160),
                    nullable(request.source(), 240),
                    nullable(request.referrer(), 240),
                    nullable(request.deviceType(), 40),
                    nullable(request.deviceModel(), 160),
                    nullable(request.osName(), 80),
                    nullable(request.osVersion(), 80),
                    nullable(request.browserName(), 80),
                    nullable(request.browserVersion(), 80),
                    nullable(request.screenSize(), 80),
                    nullable(request.viewportSize(), 80),
                    nullable(request.language(), 40),
                    nullable(request.userAgent(), 500));
            return true;
        } catch (DuplicateKeyException duplicate) {
            return false;
        }
    }

    private void notifyAdmins(SiteVisitRequest request) {
        if (!webPushService.isConfigured()) return;

        String source = clean(request.source(), 240);
        String device = deviceSummary(request);

        StringBuilder body = new StringBuilder("Кто-то открыл mindcrafti.de");
        if (!device.isBlank()) body.append(" · ").append(device);
        if (!source.isBlank()) body.append(" · источник: ").append(source);

        try {
            for (var admin : userRepository.findAllByRoleOrderByFullNameAsc(Role.ADMIN)) {
                for (PushSubscription subscription : subscriptionRepository.findAllByUserId(admin.getId())) {
                    try {
                        webPushService.send(
                                subscription,
                                "Новый посетитель сайта",
                                body.toString(),
                                "/admin/leads");
                    } catch (Exception e) {
                        log.warn("Failed to send site visit push to admin {}", admin.getId(), e);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to dispatch site visit push notifications", e);
        }
    }

    private static String deviceSummary(SiteVisitRequest request) {
        String model = clean(request.deviceModel(), 160);
        String type = clean(request.deviceType(), 40);
        String os = joinVersion(request.osName(), request.osVersion());
        String browser = joinVersion(request.browserName(), request.browserVersion());

        StringBuilder result = new StringBuilder();
        if (!model.isBlank()) result.append(model);
        else if (!type.isBlank()) result.append(type);
        if (!os.isBlank()) {
            if (!result.isEmpty()) result.append(" · ");
            result.append(os);
        }
        if (!browser.isBlank()) {
            if (!result.isEmpty()) result.append(" · ");
            result.append(browser);
        }
        return result.toString();
    }

    private static String joinVersion(String name, String version) {
        String cleanName = clean(name, 80);
        String cleanVersion = clean(version, 80);
        if (cleanName.isBlank()) return "";
        return cleanVersion.isBlank() ? cleanName : cleanName + " " + cleanVersion;
    }

    private static boolean isFunnelEvent(String event) {
        return switch (event) {
            case "TRIAL_CTA_CLICK", "TRIAL_PAGE_LOADED", "GRADE_OPTIONS_VISIBLE", "GRADE_TAP",
                    "GRADE_SELECTED", "GOAL_SELECTED", "PRIORITY_SELECTED", "PHONE_STEP",
                    "FORM_COMPLETED", "TEACHER_SELECTED", "CALENDAR_OPENED", "BOOKED" -> true;
            default -> false;
        };
    }

    private static boolean isDiagnosticEvent(String event) {
        return switch (event) {
            case "FIRST_INTERACTION", "SCROLLED", "ACTIVE", "PAGE_HIDDEN", "JS_ERROR",
                    "UNHANDLED_REJECTION" -> true;
            default -> false;
        };
    }

    private static String nullable(String value, int maxLength) {
        String cleaned = clean(value, maxLength);
        return cleaned.isBlank() ? null : cleaned;
    }

    private static String clean(String value, int maxLength) {
        if (value == null) return "";
        String cleaned = value.strip().replaceAll("[\\r\\n]+", " ");
        return cleaned.substring(0, Math.min(cleaned.length(), maxLength));
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    public record SiteVisitRequest(
            @NotBlank @Size(max = 80) String sessionId,
            @Size(max = 160) String path,
            @Size(max = 240) String source,
            @Size(max = 240) String referrer,
            @Size(max = 40) String deviceType,
            @Size(max = 160) String deviceModel,
            @Size(max = 80) String osName,
            @Size(max = 80) String osVersion,
            @Size(max = 80) String browserName,
            @Size(max = 80) String browserVersion,
            @Size(max = 80) String screenSize,
            @Size(max = 80) String viewportSize,
            @Size(max = 40) String language,
            @Size(max = 500) String userAgent
    ) {}

    public record FunnelProgressRequest(
            @Size(max = 40) String event,
            @Size(max = 160) String path,
            @Size(max = 80) String grade,
            @Size(max = 500) String goal,
            @Size(max = 500) String priority,
            Integer scrollPercent,
            Integer activeSeconds,
            @Size(max = 160) String interactionLabel,
            @Size(max = 500) String clientError
    ) {}

    public record SiteVisitResponse(
            UUID id,
            String sessionId,
            String path,
            String source,
            String referrer,
            String deviceType,
            String deviceModel,
            String osName,
            String osVersion,
            String browserName,
            String browserVersion,
            String screenSize,
            String viewportSize,
            String language,
            String userAgent,
            String funnelStage,
            String diagnosticStage,
            String grade,
            String goal,
            String priority,
            String firstInteractionLabel,
            Integer maxScrollPercent,
            Integer maxActiveSeconds,
            String clientError,
            Instant trialPageLoadedAt,
            Instant gradeOptionsVisibleAt,
            Instant firstInteractionAt,
            Instant firstScrollAt,
            String leadPhone,
            String leadStatus,
            Instant createdAt,
            Instant updatedAt
    ) {}
}
