package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class McpOAuthService {

    public record Client(String clientId, String clientName, List<String> redirectUris) {}
    public record TokenPair(String accessToken, String refreshToken, long expiresIn, String scope) {}

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long ACCESS_TOKEN_SECONDS = 3600;
    private static final long REFRESH_TOKEN_DAYS = 30;
    private static final long AUTH_CODE_MINUTES = 10;

    private final JdbcTemplate jdbcTemplate;
    private final UserRepository userRepository;

    public McpOAuthService(JdbcTemplate jdbcTemplate, UserRepository userRepository) {
        this.jdbcTemplate = jdbcTemplate;
        this.userRepository = userRepository;
    }

    public Client registerClient(String clientName, List<String> redirectUris, String tokenEndpointAuthMethod) {
        if (redirectUris == null || redirectUris.isEmpty()) {
            throw new IllegalArgumentException("redirect_uris is required");
        }
        if (tokenEndpointAuthMethod != null && !tokenEndpointAuthMethod.isBlank() && !"none".equals(tokenEndpointAuthMethod)) {
            throw new IllegalArgumentException("Only token_endpoint_auth_method=none is supported");
        }
        for (String redirectUri : redirectUris) {
            validateRedirectUri(redirectUri);
        }

        String clientId = "mcp_" + randomToken(24);
        String name = clientName == null || clientName.isBlank() ? "ChatGPT MCP client" : clientName.trim();
        jdbcTemplate.update(
                "INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method) VALUES (?, ?, ?, 'none')",
                clientId, name, String.join("\n", redirectUris));
        return new Client(clientId, name, List.copyOf(redirectUris));
    }

    public Optional<Client> findClient(String clientId) {
        if (clientId == null || clientId.isBlank()) return Optional.empty();
        List<Client> clients = jdbcTemplate.query(
                "SELECT client_id, client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = ?",
                (rs, rowNum) -> new Client(
                        rs.getString("client_id"),
                        rs.getString("client_name"),
                        List.of(rs.getString("redirect_uris").split("\\n"))),
                clientId);
        return clients.stream().findFirst();
    }

    public boolean isRedirectUriAllowed(String clientId, String redirectUri) {
        return findClient(clientId)
                .map(client -> client.redirectUris().contains(redirectUri))
                .orElse(false);
    }

    public String issueAuthorizationCode(
            User user,
            String clientId,
            String redirectUri,
            String codeChallenge,
            String scope,
            String resource) {
        if (user == null || user.isArchived()) throw new IllegalArgumentException("User is not available");
        if (!isRedirectUriAllowed(clientId, redirectUri)) throw new IllegalArgumentException("Invalid redirect_uri");
        if (codeChallenge == null || codeChallenge.isBlank()) throw new IllegalArgumentException("PKCE code_challenge is required");

        String code = randomToken(32);
        jdbcTemplate.update(
                "INSERT INTO mcp_oauth_authorization_codes " +
                        "(code_hash, client_id, redirect_uri, code_challenge, scope, resource, expires_at, user_id) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                sha256(code),
                clientId,
                redirectUri,
                codeChallenge,
                normalizeScope(scope),
                resource == null ? "" : resource,
                Timestamp.from(Instant.now().plus(AUTH_CODE_MINUTES, ChronoUnit.MINUTES)),
                user.getId());
        return code;
    }

    @Transactional
    public TokenPair exchangeAuthorizationCode(
            String clientId,
            String code,
            String redirectUri,
            String codeVerifier) {
        if (clientId == null || clientId.isBlank()) throw new IllegalArgumentException("client_id is required");
        if (code == null || code.isBlank()) throw new IllegalArgumentException("code is required");
        if (codeVerifier == null || codeVerifier.isBlank()) throw new IllegalArgumentException("code_verifier is required");

        List<AuthCodeRow> rows = jdbcTemplate.query(
                "SELECT client_id, redirect_uri, code_challenge, scope, resource, expires_at, used, user_id " +
                        "FROM mcp_oauth_authorization_codes WHERE code_hash = ?",
                (rs, rowNum) -> new AuthCodeRow(
                        rs.getString("client_id"),
                        rs.getString("redirect_uri"),
                        rs.getString("code_challenge"),
                        rs.getString("scope"),
                        rs.getString("resource"),
                        rs.getTimestamp("expires_at").toInstant(),
                        rs.getBoolean("used"),
                        rs.getObject("user_id", UUID.class)),
                sha256(code));
        AuthCodeRow row = rows.stream().findFirst().orElseThrow(() -> new IllegalArgumentException("Invalid authorization code"));

        if (row.used() || row.expiresAt().isBefore(Instant.now())) throw new IllegalArgumentException("Authorization code expired or already used");
        if (!row.clientId().equals(clientId)) throw new IllegalArgumentException("client_id does not match authorization code");
        if (!row.redirectUri().equals(redirectUri)) throw new IllegalArgumentException("redirect_uri does not match authorization code");
        if (!constantTimeEquals(row.codeChallenge(), pkceChallenge(codeVerifier))) throw new IllegalArgumentException("Invalid PKCE code_verifier");
        if (row.userId() == null) throw new IllegalArgumentException("Authorization code is not linked to a user");

        int changed = jdbcTemplate.update(
                "UPDATE mcp_oauth_authorization_codes SET used = TRUE WHERE code_hash = ? AND used = FALSE",
                sha256(code));
        if (changed != 1) throw new IllegalArgumentException("Authorization code already used");

        return issueTokenPair(row.userId(), clientId, row.scope(), row.resource());
    }

    @Transactional
    public TokenPair refresh(String clientId, String refreshToken, String requestedScope) {
        if (clientId == null || clientId.isBlank()) throw new IllegalArgumentException("client_id is required");
        if (refreshToken == null || refreshToken.isBlank()) throw new IllegalArgumentException("refresh_token is required");

        List<TokenRow> rows = jdbcTemplate.query(
                "SELECT client_id, scope, resource, expires_at, revoked, user_id FROM mcp_oauth_tokens " +
                        "WHERE token_hash = ? AND token_kind = 'refresh'",
                (rs, rowNum) -> new TokenRow(
                        rs.getString("client_id"),
                        rs.getString("scope"),
                        rs.getString("resource"),
                        rs.getTimestamp("expires_at").toInstant(),
                        rs.getBoolean("revoked"),
                        rs.getObject("user_id", UUID.class)),
                sha256(refreshToken));
        TokenRow row = rows.stream().findFirst().orElseThrow(() -> new IllegalArgumentException("Invalid refresh token"));
        if (row.revoked() || row.expiresAt().isBefore(Instant.now())) throw new IllegalArgumentException("Refresh token expired or revoked");
        if (!row.clientId().equals(clientId)) throw new IllegalArgumentException("client_id does not match refresh token");
        if (row.userId() == null) throw new IllegalArgumentException("Refresh token is not linked to a user");

        String scope = requestedScope == null || requestedScope.isBlank() ? row.scope() : normalizeScope(requestedScope);
        if (!scopeSubset(scope, row.scope())) throw new IllegalArgumentException("Requested scope exceeds original grant");

        int changed = jdbcTemplate.update(
                "UPDATE mcp_oauth_tokens SET revoked = TRUE WHERE token_hash = ? AND token_kind = 'refresh' AND revoked = FALSE",
                sha256(refreshToken));
        if (changed != 1) throw new IllegalArgumentException("Refresh token already used");
        return issueTokenPair(row.userId(), clientId, scope, row.resource());
    }

    public Optional<User> resolveAccessToken(String bearerToken) {
        if (bearerToken == null || bearerToken.isBlank()) return Optional.empty();
        List<TokenRow> rows = jdbcTemplate.query(
                "SELECT client_id, scope, resource, expires_at, revoked, user_id FROM mcp_oauth_tokens " +
                        "WHERE token_hash = ? AND token_kind = 'access'",
                (rs, rowNum) -> new TokenRow(
                        rs.getString("client_id"),
                        rs.getString("scope"),
                        rs.getString("resource"),
                        rs.getTimestamp("expires_at").toInstant(),
                        rs.getBoolean("revoked"),
                        rs.getObject("user_id", UUID.class)),
                sha256(bearerToken));
        return rows.stream()
                .filter(row -> !row.revoked() && row.expiresAt().isAfter(Instant.now()) && row.userId() != null)
                .findFirst()
                .flatMap(row -> userRepository.findById(row.userId()))
                .filter(user -> !user.isArchived());
    }

    private TokenPair issueTokenPair(UUID userId, String clientId, String scope, String resource) {
        String accessToken = randomToken(32);
        String refreshToken = randomToken(40);
        Instant now = Instant.now();

        jdbcTemplate.update(
                "INSERT INTO mcp_oauth_tokens (token_hash, token_kind, client_id, scope, resource, expires_at, user_id) " +
                        "VALUES (?, 'access', ?, ?, ?, ?, ?)",
                sha256(accessToken), clientId, scope, resource,
                Timestamp.from(now.plusSeconds(ACCESS_TOKEN_SECONDS)), userId);
        jdbcTemplate.update(
                "INSERT INTO mcp_oauth_tokens (token_hash, token_kind, client_id, scope, resource, expires_at, user_id) " +
                        "VALUES (?, 'refresh', ?, ?, ?, ?, ?)",
                sha256(refreshToken), clientId, scope, resource,
                Timestamp.from(now.plus(REFRESH_TOKEN_DAYS, ChronoUnit.DAYS)), userId);

        return new TokenPair(accessToken, refreshToken, ACCESS_TOKEN_SECONDS, scope);
    }

    private static String normalizeScope(String scope) {
        if (scope == null || scope.isBlank()) return "mcp:tools offline_access";
        return String.join(" ", List.of(scope.trim().split("\\s+")).stream().distinct().sorted().toList());
    }

    private static boolean scopeSubset(String requested, String original) {
        List<String> allowed = List.of(original.split("\\s+"));
        for (String item : requested.split("\\s+")) {
            if (!allowed.contains(item)) return false;
        }
        return true;
    }

    private static void validateRedirectUri(String value) {
        try {
            java.net.URI uri = java.net.URI.create(value);
            String scheme = uri.getScheme();
            if (scheme == null || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))) {
                throw new IllegalArgumentException("redirect_uri must use http or https");
            }
            if (scheme.equalsIgnoreCase("http") && !"localhost".equalsIgnoreCase(uri.getHost()) && !"127.0.0.1".equals(uri.getHost())) {
                throw new IllegalArgumentException("Non-local redirect_uri must use https");
            }
            if (uri.getFragment() != null) throw new IllegalArgumentException("redirect_uri must not contain a fragment");
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Invalid redirect_uri");
        }
    }

    private static String pkceChallenge(String verifier) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(sha256Bytes(verifier));
    }

    private static String randomToken(int bytes) {
        byte[] raw = new byte[bytes];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    private static String sha256(String value) {
        byte[] hash = sha256Bytes(value);
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private static byte[] sha256Bytes(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }

    private record AuthCodeRow(
            String clientId,
            String redirectUri,
            String codeChallenge,
            String scope,
            String resource,
            Instant expiresAt,
            boolean used,
            UUID userId) {}

    private record TokenRow(
            String clientId,
            String scope,
            String resource,
            Instant expiresAt,
            boolean revoked,
            UUID userId) {}
}
