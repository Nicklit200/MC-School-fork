package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.stereotype.Component;

/**
 * Trial-only gate for the Mindcrafti Online classroom.
 *
 * The room owner is selected using the server-verified JWT principal, never a
 * user id provided by the browser. The feature is deny-by-default until both
 * ONLINE_CLASSES_ENABLED and ONLINE_CLASSES_PILOT_OWNER_ID are configured.
 *
 * Students attached to the pilot teacher may JOIN their assigned classes.
 * The online class service must still verify the particular class membership;
 * this gate is an additional restriction, not a replacement for that check.
 */
@Component
public class OnlineClassPilotAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final UserRepository userRepository;
    private final boolean enabled;
    private final UUID pilotOwnerId;

    public OnlineClassPilotAuthorizationManager(
            UserRepository userRepository,
            @Value("${app.online-classes.enabled:false}") boolean enabled,
            @Value("${app.online-classes.pilot-owner-id:}") String pilotOwnerId) {
        this.userRepository = userRepository;
        this.enabled = enabled;
        this.pilotOwnerId = pilotOwnerId == null || pilotOwnerId.isBlank()
                ? null
                : UUID.fromString(pilotOwnerId.trim());
    }

    @Override
    public AuthorizationDecision authorize(
            Supplier<? extends Authentication> authentication,
            RequestAuthorizationContext context) {
        return new AuthorizationDecision(isAllowed(authentication.get()));
    }

    boolean isAllowed(Authentication authentication) {
        if (!enabled || pilotOwnerId == null || authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUser caller)) {
            return false;
        }

        if (caller.role() == Role.TEACHER) {
            return pilotOwnerId.equals(caller.id());
        }

        // Students must be able to join their teacher's test classroom by link.
        // In addition, the room's own access service enforces class enrollment.
        if (caller.role() == Role.STUDENT) {
            return userRepository.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
                    caller.id(), pilotOwnerId, Role.STUDENT, UserStatus.ACTIVE);
        }

        // Do not open classroom APIs to administrators or parents by role alone.
        return false;
    }
}
