package com.mcschool.flashcard.notifications;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Own-account registration for Expo native app installations. */
@Service
public class NativePushDevices {
    public record Device(UUID id, UUID userId, String token, String platform) {}
    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final ExpoPushService push;

    public NativePushDevices(JdbcTemplate jdbc, UserRepository users, ExpoPushService push) {
        this.jdbc=jdbc;
        this.users=users;
        this.push=push;
    }

    @Transactional
    public void register(AuthenticatedUser principal, String token, String platform) {
        User user = activeAccount(principal);
        // The iOS WebView can authenticate once per user. Associate a device
        // with exactly that account, even if another user used the same phone.
        Integer devices = jdbc.queryForObject("""
                SELECT count(*) FROM native_push_devices
                WHERE user_id=? AND disabled_at IS NULL AND expo_token<>?
                """, Integer.class, user.getId(), token);
        if (devices != null && devices >= 10)
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Maximum number of notification devices reached");
        jdbc.update("""
            INSERT INTO native_push_devices (id,user_id,expo_token,platform)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (expo_token) DO UPDATE SET
                user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,
                last_seen_at=now(),disabled_at=NULL
            """,UUID.randomUUID(),user.getId(),token,platform);
    }

    @Transactional
    public void unregister(AuthenticatedUser principal, String token) {
        jdbc.update("""
            UPDATE native_push_devices SET disabled_at=now()
            WHERE user_id=? AND expo_token=? AND disabled_at IS NULL
            """,principal.id(),token);
    }

    @Transactional(readOnly=true)
    public List<Device> devicesFor(UUID userId) {
        return jdbc.query("""
            SELECT id,user_id,expo_token,platform FROM native_push_devices
            WHERE user_id=? AND disabled_at IS NULL
            ORDER BY created_at DESC
            """,(rs,i)->new Device(rs.getObject("id",UUID.class),
                rs.getObject("user_id",UUID.class),rs.getString("expo_token"),
                rs.getString("platform")),userId);
    }

    @Transactional(readOnly=true)
    public int count(UUID userId) {
        return jdbc.queryForObject("""
            SELECT count(*) FROM native_push_devices
            WHERE user_id=? AND disabled_at IS NULL
            """, Integer.class,userId);
    }

    @Transactional
    public void disable(UUID deviceId) {
        jdbc.update("UPDATE native_push_devices SET disabled_at=now() WHERE id=?",deviceId);
    }

    /** A test push belongs to the signed-in user. Never accepts a target ID. */
    public int sendTest(AuthenticatedUser principal) {
        activeAccount(principal);
        List<Device> devices=devicesFor(principal.id());
        if (devices.isEmpty())
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "No native devices registered for this account");
        int accepted=0;
        for(Device device:devices) {
            try {
                push.send(device.token(), "Mindcrafti School",
                        "Тестовое уведомление работает!", "/parent");
                accepted++;
            } catch(ExpoPushService.DeviceNotRegisteredException expired) {
                disable(device.id());
            } catch(RuntimeException rejected) {
                // Do not expose Expo push tokens in exceptions or logs.
            }
        }
        if(accepted==0)
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "No native notification was accepted by Expo");
        return accepted;
    }

    private User activeAccount(AuthenticatedUser principal) {
        if (principal == null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return users.findById(principal.id())
                .filter(user->!user.isArchived()
                    && user.getStatus()==UserStatus.ACTIVE
                    && user.getRole()==principal.role())
                .orElseThrow(()->new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Account is not active"));
    }
}
