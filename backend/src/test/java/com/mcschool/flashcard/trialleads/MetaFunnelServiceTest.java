package com.mcschool.flashcard.trialleads;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.net.http.HttpRequest;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import tools.jackson.databind.json.JsonMapper;

class MetaFunnelServiceTest {
    private final UUID id = UUID.randomUUID();
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final MetaFunnelService.PendingEvent event = new MetaFunnelService.PendingEvent(id,
            "Schedule", MetaFunnelService.eventId(id, "Schedule"), Instant.parse("2026-11-05T10:00:00Z"), "TEST123");
    private final MetaFunnelService.LeadMatch lead = new MetaFunnelService.LeadMatch(" Parent@Example.com ",
            "+49 (151) 23456789", "fb.1.1700000000000.12345", "fb.1.1700000000000.click-id",
            "https://mindcrafti.de/ru/trial", "192.0.2.1", "VisitorBrowser", true);

    @Test void normalizesAndHashesContactsWithoutGuessingPhoneCountry() {
        assertEquals("parent@example.com", MetaFunnelService.normalizeEmail(" Parent@Example.com "));
        assertEquals("4915123456789", MetaFunnelService.normalizePhone("0049 (151) 23456789"));
        assertEquals("4915123456789", MetaFunnelService.normalizePhone("+49 (151) 23456789"));
        assertEquals("", MetaFunnelService.normalizePhone("015123456789"));
        assertEquals("", MetaFunnelService.normalizePhone(null));
        assertEquals("", MetaFunnelService.normalizeEmail("invalid email"));
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", MetaFunnelService.sha256("abc"));
    }

    @Test void buildsLinkedWebsitePayloadAndKeepsAttributionUnhashed() {
        var service = service(request -> new MetaFunnelService.MetaResponse(200, "{}"));
        var payload = mapper.valueToTree(service.payload(event, lead));
        var sent = payload.path("data").get(0);
        assertEquals("Schedule", sent.path("event_name").asString());
        assertEquals("website", sent.path("action_source").asString());
        assertEquals(event.eventId(), sent.path("event_id").asString());
        assertEquals(event.occurredAt().getEpochSecond(), sent.path("event_time").asLong());
        assertEquals(lead.sourceUrl(), sent.path("event_source_url").asString());
        var match = sent.path("user_data");
        assertEquals(MetaFunnelService.sha256("parent@example.com"), match.path("em").get(0).asString());
        assertEquals(MetaFunnelService.sha256("4915123456789"), match.path("ph").get(0).asString());
        assertEquals(lead.fbp(), match.path("fbp").asString());
        assertEquals(lead.fbc(), match.path("fbc").asString());
        assertEquals(lead.clientIp(), match.path("client_ip_address").asString());
        assertEquals(lead.userAgent(), match.path("client_user_agent").asString());
        assertEquals("TEST123", payload.path("test_event_code").asString());
        assertNotEquals(event.eventId(), MetaFunnelService.eventId(id, "QualifiedLead"));
        assertEquals("meta_purchase_sent_at", MetaFunnelService.sentAtColumn("ConvertedLead"));
    }

    @Test void queuesInitialLeadWithPixelMatchingEventIdAndNoNetworkSend() {
        UUID trackingToken = UUID.randomUUID();
        MetaFunnelService.Transport transport = mock(MetaFunnelService.Transport.class);
        service(transport).recordLead(id, trackingToken);
        verify(jdbc).update(contains("INSERT INTO trial_lead_meta_conversions"),
                eq("Lead"), eq("mindcrafti-Lead-" + trackingToken), eq("TEST123"),
                eq(id), eq("Lead"), eq(id));
        verifyNoInteractions(transport);
        assertEquals("meta_lead_sent_at", MetaFunnelService.sentAtColumn("Lead"));
    }

    @Test void initialLeadPayloadUsesStableIdAndStandardLeadEvent() {
        UUID trackingToken = UUID.randomUUID();
        var initialEvent = new MetaFunnelService.PendingEvent(
                id, "Lead", MetaFunnelService.eventId(trackingToken, "Lead"),
                Instant.parse("2026-11-18T06:06:04Z"), null);
        var sent = mapper.valueToTree(service(request -> new MetaFunnelService.MetaResponse(200, "{}"))
                .payload(initialEvent, lead)).path("data").get(0);
        assertEquals("Lead", sent.path("event_name").asString());
        assertEquals("mindcrafti-Lead-" + trackingToken, sent.path("event_id").asString());
        assertEquals("website", sent.path("action_source").asString());
    }

    @Test void sanitizesMetaResponseRatherThanLoggingApiMessages() {
        var response = mapper.readTree("""
                {"error":{"code":190,"error_subcode":463,"message":"SECRET_TOKEN parent@example.com",
                "fbtrace_id":"Trace_123"},"messages":["+4915123456789"]}
                """);
        String summary = MetaFunnelService.responseSummary(400, response).toString();
        assertTrue(summary.contains("190"));
        assertTrue(summary.contains("Trace_123"));
        assertFalse(summary.contains("SECRET"));
        assertFalse(summary.contains("parent@"));
        assertFalse(summary.contains("4915"));
        assertFalse(MetaFunnelService.responseSummary(400, mapper.readTree("{\"fbtrace_id\":\"parent@example.com\"}"))
                .containsKey("fbtrace_id"));
    }

    @Test void onlyMarksAcceptedEventsSent() throws Exception {
        allowClaimAndLead(lead);
        MetaFunnelService.Transport transport = mock(MetaFunnelService.Transport.class);
        when(transport.send(any())).thenReturn(new MetaFunnelService.MetaResponse(200, "{\"events_received\":1}"));
        service(transport).deliver(event);
        verify(jdbc).update(contains("WITH accepted AS"), eq("TEST_SENT"), eq(id), eq("Schedule"), eq(id));
        verify(jdbc, never()).update(contains("status='FAILED'"), any(), any(), any());
    }

    @Test void http200WithoutAcceptanceIsRetryableAndNeverSetsSentTimestamp() throws Exception {
        allowClaimAndLead(lead);
        service(request -> new MetaFunnelService.MetaResponse(200, "{\"events_received\":0}")).deliver(event);
        verify(jdbc).update(contains("status='FAILED'"), eq("meta_rejected_http_200_code_0"), eq(id), eq("Schedule"));
        verify(jdbc, never()).update(contains("WITH accepted AS"), any(), any(), any(), any());
    }

    @Test void timeoutDoesNotEscapeAndRetryKeepsTheSameIdAndTime() throws Exception {
        allowClaimAndLead(lead);
        List<String> bodies = new ArrayList<>();
        MetaFunnelService service = service(request -> {
            bodies.add(body(request));
            if (bodies.size() == 1) throw new HttpTimeoutException("SECRET parent@example.com");
            return new MetaFunnelService.MetaResponse(200, "{\"events_received\":1}");
        });
        assertDoesNotThrow(() -> service.deliver(event));
        service.deliver(event);
        assertEquals(2, bodies.size());
        assertEquals(bodies.get(0), bodies.get(1));
        verify(jdbc).update(contains("status='FAILED'"), eq("HttpTimeoutException"), eq(id), eq("Schedule"));
    }

    @Test void losingConcurrentClaimDoesNotSend() throws Exception {
        when(jdbc.update(contains("claimed_at=CURRENT_TIMESTAMP"), eq(id), eq("Schedule"))).thenReturn(0);
        MetaFunnelService.Transport transport = mock(MetaFunnelService.Transport.class);
        service(transport).deliver(event);
        verifyNoInteractions(transport);
    }

    @Test void revokedConsentPreventsDeliveryEvenAfterEnqueue() throws Exception {
        allowClaimAndLead(new MetaFunnelService.LeadMatch(lead.email(), lead.phone(), lead.fbp(), lead.fbc(),
                lead.sourceUrl(), lead.clientIp(), lead.userAgent(), false));
        MetaFunnelService.Transport transport = mock(MetaFunnelService.Transport.class);
        service(transport).deliver(event);
        verifyNoInteractions(transport);
        verify(jdbc).update(contains("SET status=?,last_error=?"), eq("SUPPRESSED"), eq("marketing_consent_missing"), eq(id), eq("Schedule"));
    }

    @Test void outboxStorageFailureDoesNotFailTheLeadRequest() {
        when(jdbc.update(contains("INSERT INTO trial_lead_meta_conversions"), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("SECRET"));
        var service = service(request -> new MetaFunnelService.MetaResponse(200, "{}"));
        assertDoesNotThrow(() -> service.recordSchedule(id));
        assertDoesNotThrow(() -> service.recordQualifiedLead(id));
        assertDoesNotThrow(() -> service.recordContract(id));
    }

    @Test void disabledSenderMakesNoDatabaseOrNetworkCalls() throws Exception {
        MetaFunnelService.Transport transport = mock(MetaFunnelService.Transport.class);
        new MetaFunnelService(jdbc, mapper, "secret", null, false, "1391828005920802", "v26.0", transport).deliverPending();
        verifyNoInteractions(jdbc, transport);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void allowClaimAndLead(MetaFunnelService.LeadMatch match) {
        when(jdbc.update(contains("claimed_at=CURRENT_TIMESTAMP"), eq(id), eq("Schedule"))).thenReturn(1);
        when(jdbc.query(contains("FROM trial_leads WHERE id=?"), any(RowMapper.class), eq(id)))
                .thenReturn((List) List.of(match));
    }

    private MetaFunnelService service(MetaFunnelService.Transport transport) {
        return new MetaFunnelService(jdbc, mapper, "secret-token", "TEST123", true, "1391828005920802", "v26.0", transport);
    }

    private static String body(HttpRequest request) {
        StringBuilder body = new StringBuilder();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            public void onSubscribe(Flow.Subscription subscription) { subscription.request(Long.MAX_VALUE); }
            public void onNext(ByteBuffer buffer) { body.append(StandardCharsets.UTF_8.decode(buffer)); }
            public void onError(Throwable error) { throw new AssertionError(error); }
            public void onComplete() { }
        });
        return body.toString();
    }
}
