package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.users.Language;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Berlin-time native app push reminders:
 *   19:00  -- assigned TODAY, still missing;
 *   09:00  -- assigned YESTERDAY, still missing (already overdue at midnight).
 *
 * A persistent one-per-device/student/date/phase outbox prevents duplicates
 * across server restarts and multiple Railway instances. Before a queued push
 * is sent, completed homework, disabled devices, and relinked students are
 * rechecked. No push goes to someone no longer linked as the parent.
 */
@Service
@ConditionalOnProperty(name="app.native-parent-reminders.enabled",
        havingValue="true", matchIfMissing=true)
public class ParentHomeworkMobileReminderService {
    private static final Logger LOG=LoggerFactory.getLogger(ParentHomeworkMobileReminderService.class);
    private static final int MAX_ATTEMPTS=5;
    private final UserRepository users;
    private final HomeworkRepository homeworks;
    private final NativePushDevices devices;
    private final ExpoPushService expo;
    private final JdbcTemplate jdbc;
    private final ZoneId zone;

    public record Delivery(UUID id, UUID parentId, UUID studentId, UUID deviceId,
                           String token, LocalDate homeworkDay, String phase, int attempts) {}

    public ParentHomeworkMobileReminderService(
            UserRepository users, HomeworkRepository homeworks, NativePushDevices devices,
            ExpoPushService expo, JdbcTemplate jdbc,
            @Value("${app.native-parent-reminders.zone:Europe/Berlin}") String zone) {
        this.users=users;
        this.homeworks=homeworks;
        this.devices=devices;
        this.expo=expo;
        this.jdbc=jdbc;
        this.zone=ZoneId.of(zone);
    }

    @Scheduled(cron="${app.native-parent-reminders.evening-cron:0 0 19 * * *}",
               zone="${app.native-parent-reminders.zone:Europe/Berlin}")
    public void evening() {
        capture("EVENING", LocalDate.now(zone));
        sendPending();
    }

    @Scheduled(cron="${app.native-parent-reminders.morning-cron:0 0 9 * * *}",
               zone="${app.native-parent-reminders.zone:Europe/Berlin}")
    public void morning() {
        capture("MORNING_MISSED", LocalDate.now(zone).minusDays(1));
        sendPending();
    }

    /**
     * Repair a missed cron during a brief restart, and drain independently
     * of the daily capture. The allowed delivery windows cap staleness.
     */
    @Scheduled(initialDelay=25_000, fixedDelay=30_000)
    public void poll() {
        try {
            ZonedDateTime now=ZonedDateTime.now(zone);
            if (now.getHour()==19 && now.getMinute()<30)
                capture("EVENING",now.toLocalDate());
            if (now.getHour()==9 && now.getMinute()<30)
                capture("MORNING_MISSED",now.toLocalDate().minusDays(1));
            sendPending();
        } catch (RuntimeException error) {
            LOG.warn("Parent native reminder scan failed type={}",
                    error.getClass().getSimpleName());
        }
    }

    /** Capture only work that is actually unfinished at this instant. */
    void capture(String phase, LocalDate homeworkDay) {
        int queued=0;
        for (User child : users.findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(
                Role.STUDENT, UserStatus.ACTIVE)) {
            User parent=child.getParent();
            if (!activeParent(parent)
                    || homeworks.countOpenWorksheetsForDay(child.getId(),homeworkDay)==0)
                continue;
            for (NativePushDevices.Device device:devices.devicesFor(parent.getId())) {
                queued+=jdbc.update("""
                    INSERT INTO parent_homework_mobile_reminder_outbox
                        (id, device_id, parent_id, student_id, homework_day, phase)
                    VALUES (?,?,?,?,?,?)
                    ON CONFLICT (device_id, student_id, homework_day, phase) DO NOTHING
                    """,UUID.randomUUID(),device.id(),parent.getId(),child.getId(),
                        homeworkDay,phase);
            }
        }
        if (queued>0)
            LOG.info("Queued parent homework native reminders phase={} day={} count={}",
                    phase,homeworkDay,queued);
    }

    /** Bounded worker, atomic claim. Up to 50 per poll without one failing device blocking others. */
    void sendPending() {
        for(int i=0;i<50;i++) {
            Delivery delivery=claim();
            if(delivery==null)break;
            send(delivery);
        }
    }

    private Delivery claim() {
        List<Delivery> claimed=jdbc.query("""
            UPDATE parent_homework_mobile_reminder_outbox
            SET state='DELIVERING', attempts=attempts+1,
                lease_until=now()+interval '90 seconds'
            WHERE id=(
                SELECT id FROM parent_homework_mobile_reminder_outbox
                WHERE (state='PENDING' AND next_attempt_at<=now())
                   OR (state='DELIVERING' AND lease_until<now())
                ORDER BY next_attempt_at,created_at
                FOR UPDATE SKIP LOCKED LIMIT 1
            )
            RETURNING id,parent_id,student_id,device_id,homework_day,phase,attempts
            """,(rs,i)->new Delivery(
                rs.getObject("id",UUID.class),
                rs.getObject("parent_id",UUID.class),
                rs.getObject("student_id",UUID.class),
                rs.getObject("device_id",UUID.class),
                null,rs.getObject("homework_day",LocalDate.class),
                rs.getString("phase"),rs.getInt("attempts")));
        return claimed.isEmpty()?null:claimed.get(0);
    }

    private void send(Delivery delivery) {
        if (!withinWindow(delivery.phase(), delivery.homeworkDay(), ZonedDateTime.now(zone))) {
            mark(delivery.id(),"SKIPPED");
            return;
        }
        User child=users.findById(delivery.studentId()).orElse(null);
        User parent=users.findById(delivery.parentId()).orElse(null);
        if(child==null||child.isArchived()||child.getStatus()!=UserStatus.ACTIVE
                ||child.getRole()!=Role.STUDENT||!activeParent(parent)
                ||child.getParent()==null ||!child.getParent().getId().equals(parent.getId())) {
            mark(delivery.id(),"SKIPPED");
            return;
        }
        long missing=homeworks.countOpenWorksheetsForDay(child.getId(),delivery.homeworkDay());
        if(missing==0) {
            mark(delivery.id(),"SKIPPED");
            return;
        }
        List<NativePushDevices.Device> available=devices.devicesFor(parent.getId());
        NativePushDevices.Device device=available.stream()
                .filter(d->d.id().equals(delivery.deviceId())).findFirst().orElse(null);
        if(device==null) {
            mark(delivery.id(),"SKIPPED");
            return;
        }
        boolean de=parent.getPreferredLanguage()==Language.DE;
        boolean morning="MORNING_MISSED".equals(delivery.phase());
        String title=de?(morning?"Mindcrafti: Hausaufgabe versäumt":
                "Mindcrafti: Hausaufgabe offen"):
                (morning?"Mindcrafti: домашка пропущена":"Mindcrafti: домашка не сдана");
        String body=body(child.getFullName(),missing,morning,de);
        try {
            expo.send(device.token(),title,body,"/parent");
            mark(delivery.id(),"SENT");
            LOG.info("Parent native reminder accepted phase={} day={} parentId={} childId={}",
                    delivery.phase(),delivery.homeworkDay(),parent.getId(),child.getId());
        } catch(ExpoPushService.DeviceNotRegisteredException expired) {
            devices.disable(device.id());
            mark(delivery.id(),"SKIPPED");
        } catch(RuntimeException failure) {
            if(delivery.attempts()>=MAX_ATTEMPTS) {
                mark(delivery.id(),"FAILED");
            } else {
                int delay=Math.min(30,1 << delivery.attempts());
                jdbc.update("""
                    UPDATE parent_homework_mobile_reminder_outbox
                    SET state='PENDING',next_attempt_at=now()+(? * interval '1 minute'),
                        lease_until=NULL
                    WHERE id=? AND state='DELIVERING'
                    """,delay,delivery.id());
            }
            LOG.warn("Parent native reminder delivery failed phase={} day={} attempt={} type={}",
                    delivery.phase(),delivery.homeworkDay(),delivery.attempts(),
                    failure.getClass().getSimpleName());
        }
    }

    static String body(String name,long count,boolean missed,boolean german) {
        String child=name==null?"":name.strip();
        if(german)return child+(missed
                ? ": Die Hausaufgabe von gestern wurde nicht abgegeben und gilt als versäumt."
                : ": Die Hausaufgabe für heute wurde noch nicht abgegeben.");
        return child+(missed
                ? ": вчерашняя домашняя работа не сдана и отмечена как пропущенная."
                : ": сегодняшняя домашняя работа ещё не сдана.");
    }

    static boolean withinWindow(String phase, LocalDate homeworkDay, ZonedDateTime now) {
        LocalDate local=now.toLocalDate();
        LocalTime t=now.toLocalTime();
        if("EVENING".equals(phase))
            return homeworkDay.equals(local) && !t.isBefore(LocalTime.of(19,0));
        if("MORNING_MISSED".equals(phase))
            return homeworkDay.plusDays(1).equals(local)
                    && !t.isBefore(LocalTime.of(9,0)) && t.isBefore(LocalTime.of(13,0));
        return false;
    }

    private static boolean activeParent(User parent) {
        return parent!=null && parent.getRole()==Role.PARENT
                && parent.getStatus()==UserStatus.ACTIVE && !parent.isArchived();
    }

    private void mark(UUID id,String state) {
        jdbc.update("""
            UPDATE parent_homework_mobile_reminder_outbox
            SET state=?,sent_at=CASE WHEN ?='SENT' THEN now() ELSE sent_at END,
                lease_until=NULL
            WHERE id=? AND state='DELIVERING'
            """,state,state,id);
    }
}
