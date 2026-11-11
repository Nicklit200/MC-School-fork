package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.users.UserStatus;
import com.mcschool.flashcard.users.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Reads the {@code Authorization: Bearer <token>} header, verifies the token
 * and populates the security context. Requests without a valid token simply
 * stay unauthenticated — the security configuration decides whether that is
 * allowed for the requested endpoint.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final UserRepository userRepository;

    public JwtAuthenticationFilter(JwtService jwtService, UserRepository userRepository) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            jwtService.verify(header.substring(BEARER_PREFIX.length()))
                    .ifPresent(claims -> authenticate(claims, request, header.substring(BEARER_PREFIX.length())));
        }
        filterChain.doFilter(request, response);
    }

    private void authenticate(JwtService.TokenClaims claims, HttpServletRequest request, String token) {
        // Re-check the account on every request so deleted or not-yet-activated
        // accounts cannot use previously issued tokens.
        userRepository.findById(claims.userId())
                .filter(user -> user.getStatus() == UserStatus.ACTIVE)
                .filter(user -> !user.isArchived())
                .filter(user -> !user.isTrialGuest() || isAllowedGuestRequest(
                        request, jwtService.trialClassId(token).orElse(null)))
                .ifPresent(user -> {
                    AuthenticatedUser principal =
                            new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole());
                    var authorities = List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()));
                    var authentication = UsernamePasswordAuthenticationToken.authenticated(
                            principal, null, authorities);
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                });
    }

    /** Guest JWTs never authorize profiles, groups, calendars, admin or other classes. */
    static boolean isAllowedGuestRequest(HttpServletRequest request, java.util.UUID trialClassId) {
        if (trialClassId == null) return false;
        String path = request.getRequestURI();
        if ("/api/v1/auth/me".equals(path) && "GET".equals(request.getMethod())) return true;
        String root = "/api/v1/online-classes/" + trialClassId;
        if (!(path.equals(root) || path.startsWith(root + "/"))) return false;
        // All writes still pass existing per-class admission checks and
        // TEACHER-only method security. Limit guest to the exact class scope.
        return true;
    }
}
