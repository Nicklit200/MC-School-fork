package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Protects the remote MCP endpoint at the HTTP layer so MCP clients can discover
 * OAuth from a standards-compliant 401 challenge before Spring MVC dispatches
 * the JSON-RPC request.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class McpAuthorizationFilter extends OncePerRequestFilter {

    private static final String MCP_PATH = "/api/v1/mcp";
    private static final String API_KEY_HEADER = "X-Mindcrafti-Api-Key";

    private final McpOAuthService oauthService;
    private final String apiKey;
    private final String publicBaseUrl;

    public McpAuthorizationFilter(
            McpOAuthService oauthService,
            @Value("${MINDCRAFTI_LESSON_IMPORT_API_KEY:}") String apiKey,
            @Value("${MINDCRAFTI_PUBLIC_BASE_URL:${PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}}") String publicBaseUrl) {
        this.oauthService = oauthService;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !MCP_PATH.equals(request.getRequestURI())
                || "OPTIONS".equalsIgnoreCase(request.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (isAuthenticated(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        String metadataUrl = publicBaseUrl + "/.well-known/oauth-protected-resource/api/v1/mcp";
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setHeader(
                HttpHeaders.WWW_AUTHENTICATE,
                "Bearer resource_metadata=\"" + metadataUrl + "\", scope=\"mcp:tools offline_access\"");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"error\":\"unauthorized\",\"error_description\":\"Sign in with Mindcrafti OAuth to access MCP tools.\"}");
    }

    private boolean isAuthenticated(HttpServletRequest request) {
        String explicitApiKey = trim(request.getHeader(API_KEY_HEADER));
        if (hasValidApiKey(explicitApiKey)) return true;

        String authorization = trim(request.getHeader(HttpHeaders.AUTHORIZATION));
        if (!authorization.regionMatches(true, 0, "Bearer ", 0, 7)) return false;

        String bearer = authorization.substring(7).trim();
        User user = oauthService.resolveAccessToken(bearer).orElse(null);
        if (user != null && (user.getRole() == Role.ADMIN || user.getRole() == Role.TEACHER)) return true;
        return hasValidApiKey(bearer);
    }

    private boolean hasValidApiKey(String candidate) {
        if (apiKey.isBlank() || candidate.isBlank()) return false;
        return MessageDigest.isEqual(
                apiKey.getBytes(StandardCharsets.UTF_8),
                candidate.getBytes(StandardCharsets.UTF_8));
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static String stripTrailingSlash(String value) {
        String result = trim(value);
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result.isBlank() ? "https://mindcrafti-school-production.up.railway.app" : result;
    }
}
