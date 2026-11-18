package com.mcschool.flashcard.trialleads;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Shared Meta funnel outbox, adapted from the existing TrialLeadMetaController's
 * transport, contact hashing and per-lead audit design. There is no second sender.
 * Call record methods only after the application's lead/booking write succeeds.
 * The worker uses a separate transaction/connection after that write has committed.
 */
@Service
public class MetaFunnelService {
    private static final Logger log = LoggerFactory.getLogger(MetaFunnelService.class);
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8)).build();
    private static final List<String> EVENTS = List.of("Lead", "Schedule", "QualifiedLead", "ConvertedLead");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final String accessToken;
    private final String testEventCode;
    private final boolean sendingEnabled;
    private final URI endpoint;
    private final Transport transport;

    @Autowired
    public MetaFunnelService(JdbcTemplate jdbc, ObjectMapper mapper,
            @Value("${META_CAPI_ACCESS_TOKEN:}") String accessToken,
            @Value("${META_CAPI_TEST_EVENT_CODE:}") String testEventCode,
            @Value("${META_CAPI_SENDING_ENABLED:false}") boolean sendingEnabled,
            @Value("${META_CAPI_PIXEL_ID:1391828005920802}") String pixelId,
            @Value("${META_CAPI_GRAPH_VERSION:v26.0}") String graphVersion) {
        this(jdbc, mapper, accessToken, testEventCode, sendingEnabled, pixelId, graphVersion,
                request -> {
                    HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
                    return new MetaResponse(response.statusCode(), response.body());
                });
    }

    MetaFunnelService(JdbcTemplate jdbc, ObjectMapper mapper, String accessToken,
            String testEventCode, boolean sendingEnabled, String pixelId,
            String graphVersion, Transport transport) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.accessToken = accessToken == null ? "" : accessToken.strip();
        this.testEventCode = testEventCode == null || testEventCode.isBlank() ? null : testEventCode.strip();
        this.sendingEnabled = sendingEnabled;
        if (!pixelId.matches("[0-9]+") || !graphVersion.matches("v[0-9]+\\.[0-9]+")) {
            throw new IllegalArgumentException("Invalid Meta dataset/version configuration");
        }
        this.endpoint = URI.create("https://graph.facebook.com/" + graphVersion + "/" + pixelId + "/events");
        this.transport = transport;
        log.info("Meta CAPI configuration enabled={} token_present={} test_mode={}",
                sendingEnabled, !this.accessToken.isBlank(), this.testEventCode != null);
    }

    /** Initial trial form submissions share this event ID with the consented browser Pixel. */
    public void recordLeadByToken(UUID trackingToken) {
        try {
            List<UUID> leadIds = jdbc.query(
                    "SELECT id FROM trial_leads WHERE tracking_token = ?",
                    (rs, row) -> rs.getObject("id", UUID.class), trackingToken);
            if (!leadIds.isEmpty()) record(leadIds.get(0), "Lead", eventId(trackingToken, "Lead"));
        } catch (RuntimeException error) {
            // Saving the parent's request must never depend on Meta availability.
            log.error("Meta CAPI event=Lead lead_id=none error={}", error.getClass().getSimpleName());
        }
    }

    public void recordSchedule(UUID leadId) { record(leadId, "Schedule"); }
    public void recordQualifiedLead(UUID leadId) { record(leadId, "QualifiedLead"); }
    // CONTRACT is a CRM conversion. There is no payment amount/currency in this model.
    public void recordContract(UUID leadId) { record(leadId, "ConvertedLead"); }

    /**
     * Persist an admin status transition and its outbox record in one PostgreSQL
     * statement. A process crash cannot leave a committed transition without its
     * conversion. Database failures abort the statement; Meta HTTP happens later.
     * Returns zero for an unchanged status or a missing lead.
     */
    public int updateLeadStatus(UUID leadId, String status) {
        String eventName = eventForStatus(status);
        Integer changed = jdbc.queryForObject("""
                WITH changed AS (
                    UPDATE trial_leads SET status=?,updated_at=CURRENT_TIMESTAMP
                    WHERE id=? AND status IS DISTINCT FROM ?
                    RETURNING id,meta_marketing_consent
                ), recorded AS (
                    INSERT INTO trial_lead_meta_conversions
                      (lead_id,event_name,event_id,occurred_at,status,test_event_code)
                    SELECT id,?,?,CURRENT_TIMESTAMP,
                           CASE WHEN meta_marketing_consent THEN 'PENDING' ELSE 'SUPPRESSED' END,?
                    FROM changed
                    WHERE CAST(? AS VARCHAR) IS NOT NULL
                      AND (? <> 'ConvertedLead' OR NOT EXISTS (
                          SELECT 1 FROM trial_lead_meta_conversions
                          WHERE lead_id=? AND event_name='ContractSigned' AND status IN ('SENT','TEST_SENT')
                      ))
                    ON CONFLICT (lead_id,event_name) DO NOTHING
                    RETURNING lead_id
                )
                SELECT COUNT(*) FROM changed
                """, Integer.class, status, leadId, status,
                eventName, eventName == null ? null : eventId(leadId, eventName),
                testEventCode, eventName, eventName, leadId);
        int count = changed == null ? 0 : changed;
        if (eventName != null && count > 0) {
            log.info("Meta CAPI event={} lead_id={} result=status_saved_outbox_checked", eventName, leadId);
        }
        return count;
    }

    public static String eventForStatus(String status) {
        return switch (status) {
            case "BOOKED" -> "Schedule";
            case "QUALIFIED_LEAD" -> "QualifiedLead";
            case "CONTRACT" -> "ConvertedLead";
            default -> null;
        };
    }

    public static String eventId(UUID leadId, String eventName) {
        if (!EVENTS.contains(eventName)) throw new IllegalArgumentException("Unsupported Meta funnel event");
        return "mindcrafti-" + eventName + "-" + leadId;
    }

    private void record(UUID leadId, String eventName) {
        record(leadId, eventName, eventId(leadId, eventName));
    }

    private void record(UUID leadId, String eventName, String metaEventId) {
        try {
            int inserted = jdbc.update("""
                    INSERT INTO trial_lead_meta_conversions
                      (lead_id,event_name,event_id,occurred_at,status,test_event_code)
                    SELECT id,?,?,CURRENT_TIMESTAMP,
                           CASE WHEN meta_marketing_consent THEN 'PENDING' ELSE 'SUPPRESSED' END,?
                    FROM trial_leads
                    WHERE id=? AND (? <> 'ConvertedLead' OR NOT EXISTS (
                        SELECT 1 FROM trial_lead_meta_conversions
                        WHERE lead_id=? AND event_name='ContractSigned' AND status IN ('SENT','TEST_SENT')
                    ))
                    ON CONFLICT (lead_id,event_name) DO NOTHING
                    """, eventName, metaEventId, testEventCode, leadId, eventName, leadId);
            log.info("Meta CAPI event={} lead_id={} result={}", eventName, leadId,
                    inserted > 0 ? "recorded" : "already_recorded_or_missing");
        } catch (RuntimeException error) {
            // Never leak a JDBC exception message, contact details or access token.
            log.error("Meta CAPI event={} lead_id={} error={}", eventName, leadId, error.getClass().getSimpleName());
        }
    }

    @Scheduled(initialDelayString = "${META_CAPI_WORKER_DELAY_MS:15000}",
            fixedDelayString = "${META_CAPI_WORKER_DELAY_MS:15000}")
    public void deliverPending() {
        if (!sendingEnabled || accessToken.isBlank()) return;
        try {
            jdbc.update("""
                    UPDATE trial_lead_meta_conversions SET status='EXPIRED',last_error='event_older_than_7_days'
                    WHERE event_name IN ('Lead','Schedule','QualifiedLead','ConvertedLead')
                      AND occurred_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
                      AND (status IN ('PENDING','FAILED') OR
                           (status='SENDING' AND claimed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
                    """);
            List<PendingEvent> pending = jdbc.query("""
                    SELECT lead_id,event_name,event_id,occurred_at,test_event_code
                    FROM trial_lead_meta_conversions
                    WHERE event_name IN ('Lead','Schedule','QualifiedLead','ConvertedLead')
                      AND next_attempt_at <= CURRENT_TIMESTAMP
                      AND (status IN ('PENDING','FAILED') OR
                           (status='SENDING' AND claimed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
                    ORDER BY occurred_at LIMIT 25
                    """, (rs, row) -> new PendingEvent(rs.getObject("lead_id", UUID.class),
                    rs.getString("event_name"), rs.getString("event_id"),
                    rs.getTimestamp("occurred_at").toInstant(), rs.getString("test_event_code")));
            for (PendingEvent event : pending) {
                deliver(event);
                if (Thread.currentThread().isInterrupted()) break;
            }
        } catch (RuntimeException error) {
            log.error("Meta CAPI event=outbox lead_id=none error={}", error.getClass().getSimpleName());
        }
    }

    void deliver(PendingEvent event) {
        try {
            // Compare-and-set makes the claim exclusive across concurrent requests/replicas.
            // The lease is far longer than the bounded HTTP timeout, and recovers after a crash.
            int claimed = jdbc.update("""
                    UPDATE trial_lead_meta_conversions
                    SET status='SENDING',claimed_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,last_error=NULL
                    WHERE lead_id=? AND event_name=? AND next_attempt_at <= CURRENT_TIMESTAMP
                      AND occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                      AND (status IN ('PENDING','FAILED') OR
                           (status='SENDING' AND claimed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
                    """, event.leadId(), event.eventName());
            if (claimed == 0) return;
            List<LeadMatch> matches = jdbc.query("""
                    SELECT email,phone,meta_fbp,meta_fbc,meta_event_source_url,meta_client_ip,
                           meta_user_agent,meta_marketing_consent
                    FROM trial_leads WHERE id=?
                    """, (rs, row) -> new LeadMatch(rs.getString("email"), rs.getString("phone"),
                    rs.getString("meta_fbp"), rs.getString("meta_fbc"), rs.getString("meta_event_source_url"),
                    rs.getString("meta_client_ip"), rs.getString("meta_user_agent"),
                    rs.getBoolean("meta_marketing_consent")), event.leadId());
            if (matches.isEmpty() || !matches.get(0).consent()) {
                finishWithoutSending(event, "SUPPRESSED", "marketing_consent_missing");
                return;
            }
            LeadMatch lead = matches.get(0);
            if (!validWebsiteUrl(lead.sourceUrl())) {
                fail(event, "visitor_source_url_missing_or_invalid");
                return;
            }
            Map<String, Object> payload = payload(event, lead);
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + accessToken)
                    .timeout(Duration.ofSeconds(12))
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload), StandardCharsets.UTF_8))
                    .build();
            MetaResponse response = transport.send(request);
            JsonNode responseJson = mapper.readTree(response.body());
            Map<String, Object> summary = responseSummary(response.statusCode(), responseJson);
            boolean accepted = response.statusCode() >= 200 && response.statusCode() < 300
                    && responseJson.path("events_received").asInt(0) == 1;
            log.info("Meta CAPI event={} lead_id={} response={}", event.eventName(), event.leadId(), summary);
            if (!accepted) {
                fail(event, "meta_rejected_http_" + response.statusCode()
                        + "_code_" + responseJson.path("error").path("code").asInt(0));
                return;
            }
            // One SQL statement commits audit state and the visible lead timestamp together.
            jdbc.update("""
                    WITH accepted AS (
                        UPDATE trial_lead_meta_conversions
                        SET status=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL
                        WHERE lead_id=? AND event_name=? AND status='SENDING'
                        RETURNING sent_at
                    )
                    UPDATE trial_leads SET %s=(SELECT sent_at FROM accepted)
                    WHERE id=? AND EXISTS (SELECT 1 FROM accepted)
                    """.formatted(sentAtColumn(event.eventName())),
                    event.testEventCode() == null ? "SENT" : "TEST_SENT",
                    event.leadId(), event.eventName(), event.leadId());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            failSafely(event, "InterruptedException");
        } catch (Exception error) {
            // Exception text and raw Meta bodies can reflect credentials or personal data.
            failSafely(event, error.getClass().getSimpleName());
        }
    }

    Map<String, Object> payload(PendingEvent event, LeadMatch lead) {
        Map<String, Object> userData = new LinkedHashMap<>();
        String email = normalizeEmail(lead.email());
        String phone = normalizePhone(lead.phone());
        if (!email.isEmpty()) userData.put("em", List.of(sha256(email)));
        if (!phone.isEmpty()) userData.put("ph", List.of(sha256(phone)));
        userData.put("external_id", List.of(sha256(event.leadId().toString())));
        putIfPresent(userData, "fbp", lead.fbp());
        putIfPresent(userData, "fbc", lead.fbc());
        putIfPresent(userData, "client_ip_address", lead.clientIp());
        putIfPresent(userData, "client_user_agent", lead.userAgent());
        Map<String, Object> serverEvent = Map.of(
                "event_name", event.eventName(), "event_id", event.eventId(),
                "event_time", event.occurredAt().getEpochSecond(), "action_source", "website",
                "event_source_url", lead.sourceUrl(), "user_data", userData);
        Map<String, Object> payload = new HashMap<>();
        payload.put("data", List.of(serverEvent));
        if (event.testEventCode() != null) payload.put("test_event_code", event.testEventCode());
        return payload;
    }

    static Map<String, Object> responseSummary(int httpStatus, JsonNode response) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("http_status", httpStatus);
        summary.put("events_received", response.path("events_received").asInt(0));
        JsonNode error = response.path("error");
        if (!error.isMissingNode()) {
            summary.put("error_code", error.path("code").asInt(0));
            summary.put("error_subcode", error.path("error_subcode").asInt(0));
        }
        String trace = response.path("fbtrace_id").asString("");
        if (trace.isEmpty()) trace = error.path("fbtrace_id").asString("");
        if (trace.matches("[A-Za-z0-9_-]{1,200}")) summary.put("fbtrace_id", trace);
        return summary;
    }

    private void failSafely(PendingEvent event, String reason) {
        try { fail(event, reason); }
        catch (RuntimeException error) {
            log.error("Meta CAPI event={} lead_id={} error={}", event.eventName(), event.leadId(), error.getClass().getSimpleName());
        }
    }

    private void fail(PendingEvent event, String reason) {
        jdbc.update("""
                UPDATE trial_lead_meta_conversions
                SET status='FAILED',last_error=?,next_attempt_at=CURRENT_TIMESTAMP + INTERVAL '5 minutes'
                WHERE lead_id=? AND event_name=? AND status='SENDING'
                """, reason, event.leadId(), event.eventName());
        log.warn("Meta CAPI event={} lead_id={} error={}", event.eventName(), event.leadId(), reason);
    }

    private void finishWithoutSending(PendingEvent event, String status, String reason) {
        jdbc.update("""
                UPDATE trial_lead_meta_conversions SET status=?,last_error=?
                WHERE lead_id=? AND event_name=? AND status='SENDING'
                """, status, reason, event.leadId(), event.eventName());
        log.info("Meta CAPI event={} lead_id={} result={} reason={}", event.eventName(), event.leadId(), status, reason);
    }

    static String sentAtColumn(String eventName) {
        return switch (eventName) {
            case "Lead" -> "meta_lead_sent_at";
            case "Schedule" -> "meta_schedule_sent_at";
            case "QualifiedLead" -> "meta_qualified_lead_sent_at";
            case "ConvertedLead" -> "meta_purchase_sent_at";
            default -> throw new IllegalArgumentException("Unsupported Meta funnel event");
        };
    }

    static String normalizeEmail(String raw) {
        if (raw == null) return "";
        String normalized = raw.strip().toLowerCase(Locale.ROOT);
        return normalized.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") ? normalized : "";
    }

    static String normalizePhone(String raw) {
        if (raw == null) return "";
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.startsWith("00")) digits = digits.substring(2);
        // An unqualified local number cannot be matched reliably. Never guess a country.
        if (digits.startsWith("0")) return "";
        return digits.length() >= 8 && digits.length() <= 15 ? digits : "";
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException("Unable to hash contact data");
        }
    }

    private static boolean validWebsiteUrl(String raw) {
        if (raw == null || raw.isBlank()) return false;
        try {
            URI uri = URI.create(raw);
            return ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
                    && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (IllegalArgumentException error) { return false; }
    }

    private static void putIfPresent(Map<String, Object> target, String key, String value) {
        if (value != null && !value.isBlank()) target.put(key, value);
    }

    record PendingEvent(UUID leadId, String eventName, String eventId, Instant occurredAt, String testEventCode) {}
    record LeadMatch(String email, String phone, String fbp, String fbc, String sourceUrl,
                     String clientIp, String userAgent, boolean consent) {}
    record MetaResponse(int statusCode, String body) {}
    @FunctionalInterface interface Transport { MetaResponse send(HttpRequest request) throws Exception; }
}
