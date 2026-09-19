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
        jdbc.update("""
                UPDATE site_visits SET
                    funnel_stage = COALESCE(?, funnel_stage),
                    grade = COALESCE(?, grade),
                    goal = COALESCE(?, goal),
                    priority = COALESCE(?, priority),
                    updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ?
                """,
                nullable(request.event(), 40),
                nullable(request.grade(), 80),
                nullable(request.goal(), 500),
                nullable(request.priority(), 500),
                clean(sessionId, 80));
    }

    @GetMapping("/admin/site-visits")
    @PreAuthorize("hasRole('ADMIN')")
    public List<SiteVisitResponse> list() {
        return jdbc.query("""
                SELECT v.id, v.session_id, v.path, v.source, v.referrer, v.device_type, v.device_model,
                       v.os_name, v.os_version, v.browser_name, v.browser_version, v.screen_size,
                       v.viewport_size, v.language, v.user_agent, v.funnel_stage,
                       v.grade, v.goal, v.priority, v.created_at, v.updated_at,
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
                rs.getString("grade"),
                rs.getString("goal"),
                rs.getString("priority"),
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
            @Size(max = 80) String grade,
            @Size(max = 500) String goal,
            @Size(max = 500) String priority
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
            String grade,
            String goal,
            String priority,
            String leadPhone,
            String leadStatus,
            Instant createdAt,
            Instant updatedAt
    ) {}
}
