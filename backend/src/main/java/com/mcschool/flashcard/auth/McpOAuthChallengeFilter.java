package com.mcschool.flashcard.auth;

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
 * OAuth 2.1 challenge for the remote MCP protected resource.
 *
 * MCP clients discover OAuth from a 401 + WWW-Authenticate challenge. Returning
 * an anonymous/diagnostic MCP response prevents clients such as ChatGPT from
 * starting protected-resource discovery, even when the .well-known metadata
 * endpoints themselves exist.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class McpOAuthChallengeFilter extends OncePerRequestFilter {

    private static final String MCP_PATH = "/api/v1/mcp";
    private static final String API_KEY_HEADER = "X-Mindcrafti-Api-Key";

    private final McpOAuthService oauthService;
    private final String apiKey;
    private final String publicBaseUrl;

    public McpOAuthChallengeFilter(
            McpOAuthService oauthService,
            @Value("${MINDCRAFTI_LESSON_IMPORT_API_KEY:}") String apiKey,
            @Value("${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}") String publicBaseUrl) {
        this.oauthService = oauthService;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !(MCP_PATH.equals(path) || (MCP_PATH + "/").equals(path))
                || "OPTIONS".equalsIgnoreCase(request.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        if (hasValidApiKey(request.getHeader(API_KEY_HEADER))) {
            filterChain.doFilter(request, response);
            return;
        }

        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            String bearer = authorization.substring(7).trim();
            if (hasValidApiKey(bearer)) {
                filterChain.doFilter(request, response);
                return;
            }
            User user = oauthService.resolveAccessToken(bearer).orElse(null);
            if (user != null && !user.isArchived()) {
                filterChain.doFilter(request, response);
                return;
            }
        }

        String metadataUrl = publicBaseUrl + "/.well-known/oauth-protected-resource/api/v1/mcp";
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader(
                HttpHeaders.WWW_AUTHENTICATE,
                "Bearer error=\"invalid_token\", error_description=\"Authentication required\", "
                        + "resource_metadata=\"" + metadataUrl + "\", scope=\"mcp:tools offline_access\"");
        response.getWriter().write(
                "{\"error\":\"invalid_token\",\"error_description\":\"Authentication required\"}");
    }

    private boolean hasValidApiKey(String candidate) {
        if (apiKey.isBlank() || candidate == null || candidate.isBlank()) return false;
        return MessageDigest.isEqual(
                apiKey.getBytes(StandardCharsets.UTF_8),
                candidate.trim().getBytes(StandardCharsets.UTF_8));
    }

    private static String stripTrailingSlash(String value) {
        if (value == null) return "";
        String result = value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }
}
