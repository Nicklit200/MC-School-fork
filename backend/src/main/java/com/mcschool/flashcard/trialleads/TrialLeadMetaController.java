package com.mcschool.flashcard.trialleads;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Admin-only manual feedback from actual signed trial contracts to the Mindcrafti Meta dataset.
 * Sending is never triggered by merely changing a CRM status: a real contract timestamp and
 * a documented legal basis for matching a parent's phone with Meta are required.
 */
@RestController
@RequestMapping("/api/v1/admin/trial-lead-meta")
@PreAuthorize("hasRole('ADMIN')")
public class TrialLeadMetaController {
    private static final String CONTRACT_EVENT = "ContractSigned";
    private static final String DATASET_ID = "1391828005920802";
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8)).build();

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final String accessToken;
    private final String testEventCode;
    private final boolean sendingEnabled;

    public TrialLeadMetaController(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            @Value("${META_CAPI_ACCESS_TOKEN:}") String accessToken,
            @Value("${META_CAPI_TEST_EVENT_CODE:}") String testEventCode,
            @Value("${META_CAPI_SENDING_ENABLED:false}") boolean sendingEnabled) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.accessToken = accessToken;
        this.testEventCode = testEventCode;
        this.sendingEnabled = sendingEnabled;
    }

    @GetMapping
    public List<ConversionState> list() {
        requireEnabled();
        return jdbc.query("""
                SELECT lead_id, event_name, occurred_at, status, sent_at
                FROM trial_lead_meta_conversions
                ORDER BY created_at DESC
                """, (rs, row) -> new ConversionState(
                rs.getObject("lead_id", UUID.class),
                rs.getString("event_name"),
                rs.getTimestamp("occurred_at").toInstant(),
                rs.getString("status"),
                rs.getTimestamp("sent_at") == null ? null : rs.getTimestamp("sent_at").toInstant()));
    }

    @PostMapping("/{leadId}/signed")
    public ResponseEntity<Map<String, Object>> sendContract(
            @PathVariable UUID leadId, @RequestBody SignedContractRequest request) {
        requireEnabled();
        if (request == null || !Boolean.TRUE.equals(request.permissionConfirmed())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Подтвердите документированное правовое основание для передачи конверсии в Meta");
        }
        if (request.occurredAt() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Укажите фактическую дату подписания договора");
        }
        Instant now = Instant.now();
        Instant occurred = request.occurredAt();
        if (occurred.isAfter(now.plusSeconds(30)) || occurred.isBefore(now.minus(Duration.ofDays(7)))) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Meta принимает только события с фактической датой за последние 7 дней");
        }
        if (accessToken == null || accessToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Сначала настройте секрет META_CAPI_ACCESS_TOKEN на сервере");
        }

        List<Lead> leads = jdbc.query(
                "SELECT phone, status FROM trial_leads WHERE id=?",
                (rs, row) -> new Lead(rs.getString("phone"), rs.getString("status")), leadId);
        if (leads.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Заявка не найдена");
        if (!"CONTRACT".equals(leads.get(0).status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Сначала подтвердите статус Контракт в CRM");
        }
        String phone = normalizePhone(leads.get(0).phone());
        if (phone.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Не удалось подготовить телефон родителя для сопоставления с Meta");
        }
        String eventId = "mindcrafti-contract-" + leadId;
        boolean isTest = testEventCode != null && !testEventCode.isBlank();

        int inserted = jdbc.update("""
                INSERT INTO trial_lead_meta_conversions
                 (lead_id, event_name, event_id, occurred_at, permission_confirmed_at, status)
                VALUES (?,?,?,?,CURRENT_TIMESTAMP,'SENDING')
                ON CONFLICT (lead_id,event_name) DO NOTHING
                """, leadId, CONTRACT_EVENT, eventId, Timestamp.from(occurred));

        if (inserted == 0) {
            List<ConversionState> existing = jdbc.query("""
                    SELECT lead_id,event_name,occurred_at,status,sent_at
                    FROM trial_lead_meta_conversions
                    WHERE lead_id=? AND event_name=?
                    """, (rs, row) -> new ConversionState(
                    rs.getObject("lead_id", UUID.class), rs.getString("event_name"),
                    rs.getTimestamp("occurred_at").toInstant(),
                    rs.getString("status"),
                    rs.getTimestamp("sent_at") == null ? null : rs.getTimestamp("sent_at").toInstant()),
                    leadId, CONTRACT_EVENT);
            if (existing.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Отправка уже создана");
            ConversionState prior = existing.get(0);
            if ("SENT".equals(prior.status())) return ResponseEntity.ok(Map.of("sent", true, "alreadySent", true));
            if ("TEST_SENT".equals(prior.status()) && isTest) return ResponseEntity.ok(Map.of("sent", true, "alreadySent", true, "test", true));
            // Never replace the real conversion date when retrying an event.
            if (!prior.occurredAt().equals(occurred) || !("FAILED".equals(prior.status()) || ("TEST_SENT".equals(prior.status()) && !isTest))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Событие уже обрабатывается или ранее использовало другую дату");
            }
            int claimed = jdbc.update("""
                    UPDATE trial_lead_meta_conversions SET status='SENDING', last_error=NULL
                    WHERE lead_id=? AND event_name=? AND status IN ('FAILED','TEST_SENT')
                    """, leadId, CONTRACT_EVENT);
            if (claimed == 0) throw new ResponseStatusException(HttpStatus.CONFLICT,"Отправка уже идёт");
        }

        try {
            Map<String,Object> userData = Map.of("ph", List.of(sha256(phone)));
            Map<String,Object> event = Map.of(
                    "event_name", CONTRACT_EVENT,
                    "event_time", occurred.getEpochSecond(),
                    "event_id", eventId,
                    "action_source", "system_generated",
                    "user_data", userData,
                    "custom_data", Map.of("event_source", "crm", "lead_event_source", "Mindcrafti School"));
            Map<String,Object> payload = new HashMap<>();
            payload.put("data",List.of(event));
            if (testEventCode != null && !testEventCode.isBlank()) payload.put("test_event_code", testEventCode);
            HttpRequest httpRequest = HttpRequest.newBuilder(URI.create(
                    "https://graph.facebook.com/v26.0/" + DATASET_ID + "/events"))
                    .header("Content-Type","application/json")
                    .header("Authorization","Bearer " + accessToken)
                    .timeout(Duration.ofSeconds(12))
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload),StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response=HTTP.send(httpRequest,HttpResponse.BodyHandlers.ofString());
            boolean accepted = response.statusCode() >= 200 && response.statusCode() < 300
                    && mapper.readTree(response.body()).path("events_received").asInt(0) >= 1;
            if (!accepted) {
                markFailure(leadId,"Meta rejected event");
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Meta не приняла событие; проверьте токен и настройки Pixel");
            }
            jdbc.update("""
                    UPDATE trial_lead_meta_conversions
                    SET status=?, sent_at=CURRENT_TIMESTAMP, last_error=NULL
                    WHERE lead_id=? AND event_name=?
                    """,isTest ? "TEST_SENT" : "SENT",leadId,CONTRACT_EVENT);
            return ResponseEntity.ok(Map.of(
                    "sent",true, "eventName",CONTRACT_EVENT,
                    "test", isTest));
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            markFailure(leadId,"Meta connection error");
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Сбой передачи в Meta. Повторите попытку позже, проверив журнал событий");
        }
    }

    private void requireEnabled() {
        if (!sendingEnabled) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Передача данных в Meta отключена до проверки конфиденциальности и разрешений");
        }
    }

    private void markFailure(UUID leadId, String message) {
        jdbc.update("""
                UPDATE trial_lead_meta_conversions
                SET status='FAILED', last_error=?
                WHERE lead_id=? AND event_name=?
                """,message,leadId,CONTRACT_EVENT);
    }

    static String normalizePhone(String raw) {
        if (raw == null) return "";
        String digits = raw.replaceAll("[^0-9]","");
        if (digits.startsWith("00")) digits=digits.substring(2);
        else if (digits.startsWith("0")) digits="49"+digits.substring(1);
        return digits.length() >= 8 && digits.length() <= 15 ? digits : "";
    }

    static String sha256(String value) {
        try {
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to hash contact data");
        }
    }

    public record SignedContractRequest(Instant occurredAt, Boolean permissionConfirmed) {}
    public record ConversionState(UUID leadId, String eventName, Instant occurredAt,
                                  String status, Instant sentAt) {}
    private record Lead(String phone, String status) {}
}
