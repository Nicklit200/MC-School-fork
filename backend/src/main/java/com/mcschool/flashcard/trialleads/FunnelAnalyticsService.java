package com.mcschool.flashcard.trialleads;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.sql.Timestamp;
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
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only conversion analytics for the public Mindcrafti acquisition funnel. */
@Service
public class FunnelAnalyticsService {

    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    private static final int MAX_RANGE_DAYS = 90;
    private static final int MAX_RECENT_VISITS = 100;
    private static final int MAX_WALL_SECONDS_PER_STEP = 30 * 60;

    private static final List<String> FUNNEL_STAGES = List.of(
            "VISIT",
            "TRIAL_PAGE_LOADED",
            "GRADE_OPTIONS_VISIBLE",
            "GRADE_SELECTED",
            "GOAL_SELECTED",
            "PRIORITY_SELECTED",
            "PHONE_STEP",
            "FORM_COMPLETED",
            "TEACHER_SELECTED",
            "CALENDAR_OPENED",
            "BOOKED",
            "CONTRACT"
    );

    private static final Map<String, String> STAGE_LABELS = Map.ofEntries(
            Map.entry("VISIT", "Открыл сайт"),
            Map.entry("TRIAL_PAGE_LOADED", "Открыл анкету"),
            Map.entry("GRADE_OPTIONS_VISIBLE", "Увидел выбор класса"),
            Map.entry("GRADE_SELECTED", "Выбрал класс"),
            Map.entry("GOAL_SELECTED", "Указал проблему"),
            Map.entry("PRIORITY_SELECTED", "Указал, что важно"),
            Map.entry("PHONE_STEP", "Дошёл до WhatsApp"),
            Map.entry("FORM_COMPLETED", "Оставил WhatsApp"),
            Map.entry("TEACHER_SELECTED", "Выбрал преподавателя"),
            Map.entry("CALENDAR_OPENED", "Открыл календарь"),
            Map.entry("BOOKED", "Записался"),
            Map.entry("CONTRACT", "Заключил контракт")
    );

    private final JdbcTemplate jdbc;

    public FunnelAnalyticsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> report(User actor, boolean adminLike, LocalDate fromDate, LocalDate toDate, int recentLimit) {
        if (!adminLike && (actor == null || actor.getRole() != Role.ADMIN)) {
            throw new IllegalArgumentException("Admin access is required");
        }
        validateRange(fromDate, toDate);
        int safeLimit = Math.max(1, Math.min(MAX_RECENT_VISITS, recentLimit));

        Instant from = fromDate.atStartOfDay(SCHOOL_ZONE).toInstant();
        Instant toExclusive = toDate.plusDays(1).atStartOfDay(SCHOOL_ZONE).toInstant();
        Timestamp fromTs = Timestamp.from(from);
        Timestamp toTs = Timestamp.from(toExclusive);

        List<VisitRow> visits = jdbc.query("""
                SELECT v.session_id,
                       COALESCE(NULLIF(v.source, ''), NULLIF(v.referrer, ''), 'Источник не передан') AS traffic_source,
                       COALESCE(NULLIF(v.device_model, ''), NULLIF(v.device_type, ''), 'Неизвестное устройство') AS device,
                       v.funnel_stage, v.grade, v.goal, v.priority, v.max_active_seconds,
                       v.trial_page_loaded_at, v.grade_options_visible_at, v.first_interaction_at,
                       v.created_at, l.phone AS lead_phone, l.status AS lead_status
                FROM site_visits v
                LEFT JOIN trial_leads l ON l.client_id = v.session_id
                WHERE v.created_at >= ? AND v.created_at < ?
                ORDER BY v.created_at DESC
                """, (rs, rowNum) -> new VisitRow(
                rs.getString("session_id"),
                rs.getString("traffic_source"),
                rs.getString("device"),
                rs.getString("funnel_stage"),
                rs.getString("grade"),
                rs.getString("goal"),
                rs.getString("priority"),
                (Integer) rs.getObject("max_active_seconds"),
                instant(rs.getTimestamp("trial_page_loaded_at")),
                instant(rs.getTimestamp("grade_options_visible_at")),
                instant(rs.getTimestamp("first_interaction_at")),
                instant(rs.getTimestamp("created_at")),
                rs.getString("lead_phone"),
                rs.getString("lead_status")
        ), fromTs, toTs);

        List<EventRow> events = jdbc.query("""
                SELECT e.session_id, e.event, e.active_seconds, e.interaction_label,
                       e.section_label, e.created_at
                FROM site_visit_events e
                JOIN site_visits v ON v.id = e.visit_id
                WHERE v.created_at >= ? AND v.created_at < ?
                ORDER BY e.session_id, e.created_at
                """, (rs, rowNum) -> new EventRow(
                rs.getString("session_id"),
                rs.getString("event"),
                (Integer) rs.getObject("active_seconds"),
                rs.getString("interaction_label"),
                rs.getString("section_label"),
                instant(rs.getTimestamp("created_at"))
        ), fromTs, toTs);

        Map<String, List<EventRow>> eventsBySession = new HashMap<>();
        Map<String, Set<String>> eventNamesBySession = new HashMap<>();
        for (EventRow event : events) {
            eventsBySession.computeIfAbsent(event.sessionId(), ignored -> new ArrayList<>()).add(event);
            eventNamesBySession.computeIfAbsent(event.sessionId(), ignored -> new HashSet<>()).add(event.event());
        }

        List<Map<String, Object>> funnel = funnel(visits, eventNamesBySession);
        List<Map<String, Object>> timing = timing(eventsBySession);
        List<Map<String, Object>> sources = groupStats(visits, true);
        List<Map<String, Object>> devices = groupStats(visits, false);

        int visitsCount = visits.size();
        int interactions = (int) visits.stream().filter(v -> v.firstInteractionAt() != null).count();
        int leads = (int) visits.stream().filter(v -> notBlank(v.leadPhone())).count();
        int bookings = (int) visits.stream().filter(v -> isBooked(v.leadStatus())).count();
        int contracts = (int) visits.stream().filter(v -> "CONTRACT".equals(v.leadStatus())).count();
        long activeTotal = visits.stream().map(VisitRow::maxActiveSeconds).filter(v -> v != null).mapToLong(Integer::longValue).sum();
        long activeMeasured = visits.stream().map(VisitRow::maxActiveSeconds).filter(v -> v != null).count();

        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("visits", visitsCount);
        totals.put("interactions", interactions);
        totals.put("leads", leads);
        totals.put("bookings", bookings);
        totals.put("contracts", contracts);
        totals.put("interactionRatePct", pct(interactions, visitsCount));
        totals.put("leadConversionPct", pct(leads, visitsCount));
        totals.put("bookingConversionPct", pct(bookings, visitsCount));
        totals.put("contractConversionPct", pct(contracts, visitsCount));
        totals.put("averageActiveSeconds", activeMeasured == 0 ? null : Math.round((double) activeTotal / activeMeasured));
        totals.put("averageActiveMinutes", activeMeasured == 0 ? null : round1((double) activeTotal / activeMeasured / 60.0));

        List<Map<String, Object>> recentVisits = new ArrayList<>();
        for (VisitRow visit : visits.stream().limit(safeLimit).toList()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("sessionId", visit.sessionId());
            item.put("createdAt", visit.createdAt());
            item.put("source", visit.source());
            item.put("device", visit.device());
            item.put("grade", visit.grade());
            item.put("goal", visit.goal());
            item.put("priority", visit.priority());
            item.put("activeSeconds", visit.maxActiveSeconds());
            item.put("activeMinutes", visit.maxActiveSeconds() == null ? null : round1(visit.maxActiveSeconds() / 60.0));
            item.put("leadPhone", visit.leadPhone());
            item.put("leadStatus", visit.leadStatus());
            item.put("lastKnownStage", bestKnownStage(visit, eventNamesBySession.getOrDefault(visit.sessionId(), Set.of())));

            List<Map<String, Object>> timeline = new ArrayList<>();
            for (EventRow event : eventsBySession.getOrDefault(visit.sessionId(), List.of())) {
                Map<String, Object> eventItem = new LinkedHashMap<>();
                eventItem.put("event", event.event());
                eventItem.put("label", STAGE_LABELS.getOrDefault(event.event(), event.event()));
                eventItem.put("at", event.createdAt());
                eventItem.put("activeSeconds", event.activeSeconds());
                eventItem.put("interaction", event.interactionLabel());
                eventItem.put("section", event.sectionLabel());
                timeline.add(eventItem);
            }
            item.put("timeline", timeline);
            recentVisits.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fromDate", fromDate.toString());
        result.put("toDate", toDate.toString());
        result.put("timezone", SCHOOL_ZONE.getId());
        result.put("totals", totals);
        result.put("funnel", funnel);
        result.put("stepTiming", timing);
        result.put("sources", sources);
        result.put("devices", devices);
        result.put("recentVisits", recentVisits);
        result.put("measurementLimitations", List.of(
                "Подробная история по шагам доступна только для посещений после включения site_visit_events.",
                "Время шага считается по накопленному активному времени, если оно передано; иначе по разнице между событиями с отсечением длинных простоев более 30 минут.",
                "Посетитель идентифицируется только как сессия до тех пор, пока сам не оставит WhatsApp; скрытое fingerprinting и точная геолокация не используются.",
                "Данные посещений автоматически хранятся до 90 дней."
        ));
        return result;
    }

    private List<Map<String, Object>> funnel(List<VisitRow> visits, Map<String, Set<String>> events) {
        List<Map<String, Object>> result = new ArrayList<>();
        int previous = visits.size();

        for (int i = 0; i < FUNNEL_STAGES.size(); i++) {
            String stage = FUNNEL_STAGES.get(i);
            int count = 0;
            for (VisitRow visit : visits) {
                if (reached(visit, events.getOrDefault(visit.sessionId(), Set.of()), stage)) count++;
            }

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("stage", stage);
            item.put("label", STAGE_LABELS.get(stage));
            item.put("sessions", count);
            item.put("conversionFromVisitPct", pct(count, visits.size()));
            item.put("conversionFromPreviousPct", i == 0 ? 100.0 : pct(count, previous));
            item.put("dropOffFromPrevious", i == 0 ? 0 : Math.max(0, previous - count));
            result.add(item);
            previous = count;
        }
        return result;
    }

    private List<Map<String, Object>> timing(Map<String, List<EventRow>> eventsBySession) {
        Map<String, TimingAccumulator> accumulators = new LinkedHashMap<>();
        for (String stage : FUNNEL_STAGES) {
            if (!"CONTRACT".equals(stage)) accumulators.put(stage, new TimingAccumulator());
        }

        for (List<EventRow> sessionEvents : eventsBySession.values()) {
            List<EventRow> sorted = sessionEvents.stream()
                    .sorted(Comparator.comparing(EventRow::createdAt))
                    .toList();

            for (int i = 0; i < sorted.size(); i++) {
                EventRow current = sorted.get(i);
                int currentRank = funnelRank(current.event());
                if (currentRank < 0) continue;

                EventRow next = null;
                for (int j = i + 1; j < sorted.size(); j++) {
                    EventRow candidate = sorted.get(j);
                    int candidateRank = funnelRank(candidate.event());
                    if (candidateRank > currentRank || "PAGE_HIDDEN".equals(candidate.event())) {
                        next = candidate;
                        break;
                    }
                }
                if (next == null) continue;

                Long seconds = measuredSeconds(current, next);
                if (seconds == null) continue;
                accumulators.get(current.event()).add(seconds);
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, TimingAccumulator> entry : accumulators.entrySet()) {
            TimingAccumulator value = entry.getValue();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("stage", entry.getKey());
            item.put("label", STAGE_LABELS.getOrDefault(entry.getKey(), entry.getKey()));
            item.put("samples", value.count);
            item.put("averageSecondsToNext", value.count == 0 ? null : Math.round((double) value.totalSeconds / value.count));
            item.put("averageMinutesToNext", value.count == 0 ? null : round1((double) value.totalSeconds / value.count / 60.0));
            result.add(item);
        }
        return result;
    }

    private List<Map<String, Object>> groupStats(List<VisitRow> visits, boolean bySource) {
        Map<String, GroupAccumulator> groups = new HashMap<>();
        for (VisitRow visit : visits) {
            String key = bySource ? visit.source() : visit.device();
            if (!notBlank(key)) key = bySource ? "Источник не передан" : "Неизвестное устройство";
            GroupAccumulator group = groups.computeIfAbsent(key, ignored -> new GroupAccumulator());
            group.visits++;
            if (notBlank(visit.leadPhone())) group.leads++;
            if (isBooked(visit.leadStatus())) group.bookings++;
            if ("CONTRACT".equals(visit.leadStatus())) group.contracts++;
            if (visit.maxActiveSeconds() != null) {
                group.activeSeconds += visit.maxActiveSeconds();
                group.activeMeasured++;
            }
        }

        return groups.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue().visits, a.getValue().visits))
                .limit(20)
                .map(entry -> {
                    GroupAccumulator group = entry.getValue();
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put(bySource ? "source" : "device", entry.getKey());
                    item.put("visits", group.visits);
                    item.put("leads", group.leads);
                    item.put("bookings", group.bookings);
                    item.put("contracts", group.contracts);
                    item.put("leadConversionPct", pct(group.leads, group.visits));
                    item.put("bookingConversionPct", pct(group.bookings, group.visits));
                    item.put("averageActiveSeconds", group.activeMeasured == 0 ? null : Math.round((double) group.activeSeconds / group.activeMeasured));
                    return item;
                })
                .toList();
    }

    private boolean reached(VisitRow visit, Set<String> events, String target) {
        if ("VISIT".equals(target)) return true;
        if (events.contains(target)) return true;

        int targetRank = funnelRank(target);
        int finalRank = funnelRank(visit.funnelStage());
        if (targetRank >= 0 && finalRank >= targetRank) return true;

        return switch (target) {
            case "TRIAL_PAGE_LOADED" -> visit.trialPageLoadedAt() != null;
            case "GRADE_OPTIONS_VISIBLE" -> visit.gradeOptionsVisibleAt() != null;
            case "GRADE_SELECTED" -> notBlank(visit.grade()) || leadStatusAtLeast(visit.leadStatus(), "GRADE_SELECTED");
            case "GOAL_SELECTED" -> notBlank(visit.goal()) || leadStatusAtLeast(visit.leadStatus(), "GOAL_SELECTED");
            case "PRIORITY_SELECTED" -> notBlank(visit.priority()) || leadStatusAtLeast(visit.leadStatus(), "PRIORITY_SELECTED");
            case "PHONE_STEP" -> notBlank(visit.leadPhone());
            case "FORM_COMPLETED" -> notBlank(visit.leadPhone());
            case "TEACHER_SELECTED" -> leadStatusAtLeast(visit.leadStatus(), "TEACHER_SELECTED");
            case "CALENDAR_OPENED" -> leadStatusAtLeast(visit.leadStatus(), "CALENDAR_OPENED");
            case "BOOKED" -> isBooked(visit.leadStatus());
            case "CONTRACT" -> "CONTRACT".equals(visit.leadStatus());
            default -> false;
        };
    }

    private String bestKnownStage(VisitRow visit, Set<String> events) {
        String best = "VISIT";
        for (String stage : FUNNEL_STAGES) {
            if (reached(visit, events, stage)) best = stage;
        }
        return best;
    }

    private boolean leadStatusAtLeast(String status, String target) {
        if (!notBlank(status)) return false;
        List<String> ordered = List.of(
                "NEW", "GRADE_SELECTED", "SCHOOL_SELECTED", "SUBJECT_SELECTED", "GOAL_SELECTED",
                "PRIORITY_SELECTED", "FORM_COMPLETED", "TEACHER_SELECTED", "CALENDAR_OPENED", "BOOKED", "CONTRACT"
        );
        int statusRank = ordered.indexOf(status);
        int targetRank = ordered.indexOf(target);
        return statusRank >= 0 && targetRank >= 0 && statusRank >= targetRank;
    }

    private boolean isBooked(String status) {
        return "BOOKED".equals(status) || "CONTRACT".equals(status);
    }

    private int funnelRank(String stage) {
        return FUNNEL_STAGES.indexOf(stage);
    }

    private Long measuredSeconds(EventRow current, EventRow next) {
        if (current.activeSeconds() != null && next.activeSeconds() != null) {
            long diff = (long) next.activeSeconds() - current.activeSeconds();
            if (diff >= 0) return diff;
        }
        if (current.createdAt() == null || next.createdAt() == null) return null;
        long wall = Math.max(0, Duration.between(current.createdAt(), next.createdAt()).getSeconds());
        return wall <= MAX_WALL_SECONDS_PER_STEP ? wall : null;
    }

    private void validateRange(LocalDate fromDate, LocalDate toDate) {
        if (fromDate == null || toDate == null) throw new IllegalArgumentException("fromDate and toDate are required");
        if (toDate.isBefore(fromDate)) throw new IllegalArgumentException("toDate must be on or after fromDate");
        long days = Duration.between(
                fromDate.atStartOfDay(SCHOOL_ZONE).toInstant(),
                toDate.plusDays(1).atStartOfDay(SCHOOL_ZONE).toInstant()).toDays();
        if (days > MAX_RANGE_DAYS) throw new IllegalArgumentException("Date range cannot exceed 90 days");
    }

    private static double pct(long numerator, long denominator) {
        if (denominator <= 0) return 0.0;
        return round1((double) numerator * 100.0 / denominator);
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private record VisitRow(
            String sessionId,
            String source,
            String device,
            String funnelStage,
            String grade,
            String goal,
            String priority,
            Integer maxActiveSeconds,
            Instant trialPageLoadedAt,
            Instant gradeOptionsVisibleAt,
            Instant firstInteractionAt,
            Instant createdAt,
            String leadPhone,
            String leadStatus
    ) {}

    private record EventRow(
            String sessionId,
            String event,
            Integer activeSeconds,
            String interactionLabel,
            String sectionLabel,
            Instant createdAt
    ) {}

    private static final class TimingAccumulator {
        private long totalSeconds;
        private int count;

        private void add(long seconds) {
            totalSeconds += seconds;
            count++;
        }
    }

    private static final class GroupAccumulator {
        private int visits;
        private int leads;
        private int bookings;
        private int contracts;
        private long activeSeconds;
        private int activeMeasured;
    }
}
