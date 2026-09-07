package com.mcschool.flashcard.auth;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

@RestController
public class McpOAuthController {

    private final McpOAuthService oauthService;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final String publicBaseUrl;

    public McpOAuthController(
            McpOAuthService oauthService,
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            @Value("${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}") String publicBaseUrl) {
        this.oauthService = oauthService;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
    }

    @GetMapping(value = {"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/v1/mcp"}, produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> protectedResourceMetadata() {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("resource", mcpResource());
        metadata.put("authorization_servers", List.of(publicBaseUrl));
        metadata.put("scopes_supported", List.of("mcp:tools", "offline_access"));
        metadata.put("bearer_methods_supported", List.of("header"));
        return metadata;
    }

    @GetMapping(value = "/.well-known/oauth-authorization-server", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> authorizationServerMetadata() {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("issuer", publicBaseUrl);
        metadata.put("authorization_endpoint", publicBaseUrl + "/api/v1/mcp/oauth/authorize");
        metadata.put("token_endpoint", publicBaseUrl + "/api/v1/mcp/oauth/token");
        metadata.put("registration_endpoint", publicBaseUrl + "/api/v1/mcp/oauth/register");
        metadata.put("response_types_supported", List.of("code"));
        metadata.put("grant_types_supported", List.of("authorization_code", "refresh_token"));
        metadata.put("token_endpoint_auth_methods_supported", List.of("none"));
        metadata.put("code_challenge_methods_supported", List.of("S256"));
        metadata.put("scopes_supported", List.of("mcp:tools", "offline_access"));
        return metadata;
    }

    @PostMapping(value = "/api/v1/mcp/oauth/register", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> register(@RequestBody Map<String, Object> body) {
        try {
            List<String> redirectUris = stringList(body.get("redirect_uris"));
            String clientName = string(body.get("client_name"));
            String authMethod = string(body.get("token_endpoint_auth_method"));
            McpOAuthService.Client client = oauthService.registerClient(clientName, redirectUris, authMethod);

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("client_id", client.clientId());
            response.put("client_name", client.clientName());
            response.put("redirect_uris", client.redirectUris());
            response.put("token_endpoint_auth_method", "none");
            response.put("grant_types", List.of("authorization_code", "refresh_token"));
            response.put("response_types", List.of("code"));
            response.put("client_id_issued_at", Instant.now().getEpochSecond());
            return noStore(ResponseEntity.status(HttpStatus.CREATED).body(response));
        } catch (IllegalArgumentException ex) {
            return oauthJsonError(HttpStatus.BAD_REQUEST, "invalid_client_metadata", ex.getMessage());
        }
    }

    @GetMapping(value = "/api/v1/mcp/oauth/authorize", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> authorizePage(
            @RequestParam("client_id") String clientId,
            @RequestParam("redirect_uri") String redirectUri,
            @RequestParam(value = "response_type", defaultValue = "") String responseType,
            @RequestParam(value = "scope", defaultValue = "mcp:tools offline_access") String scope,
            @RequestParam(value = "state", defaultValue = "") String state,
            @RequestParam(value = "code_challenge", defaultValue = "") String codeChallenge,
            @RequestParam(value = "code_challenge_method", defaultValue = "") String codeChallengeMethod,
            @RequestParam(value = "resource", defaultValue = "") String resource) {
        String validationError = validateAuthorizationRequest(clientId, redirectUri, responseType, codeChallenge, codeChallengeMethod, resource);
        if (validationError != null) {
            return html(HttpStatus.BAD_REQUEST, errorPage(validationError));
        }
        return html(HttpStatus.OK, loginPage(clientId, redirectUri, scope, state, codeChallenge, resource, null));
    }

    @PostMapping(value = "/api/v1/mcp/oauth/authorize", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> authorize(
            @RequestParam("client_id") String clientId,
            @RequestParam("redirect_uri") String redirectUri,
            @RequestParam(value = "scope", defaultValue = "mcp:tools offline_access") String scope,
            @RequestParam(value = "state", defaultValue = "") String state,
            @RequestParam("code_challenge") String codeChallenge,
            @RequestParam(value = "resource", defaultValue = "") String resource,
            @RequestParam("identifier") String identifier,
            @RequestParam("password") String password) {
        String validationError = validateAuthorizationRequest(clientId, redirectUri, "code", codeChallenge, "S256", resource);
        if (validationError != null) {
            return html(HttpStatus.BAD_REQUEST, errorPage(validationError));
        }

        User user = authenticate(identifier, password);
        if (user == null || (user.getRole() != Role.ADMIN && user.getRole() != Role.TEACHER)) {
            return html(HttpStatus.UNAUTHORIZED,
                    loginPage(clientId, redirectUri, scope, state, codeChallenge, resource,
                            "Неверный логин/пароль или у аккаунта нет доступа к Mindcrafti в ChatGPT."));
        }

        String code;
        try {
            code = oauthService.issueAuthorizationCode(
                    user,
                    clientId,
                    redirectUri,
                    codeChallenge,
                    scope,
                    resource.isBlank() ? mcpResource() : resource);
        } catch (IllegalArgumentException ex) {
            return html(HttpStatus.BAD_REQUEST, errorPage(ex.getMessage()));
        }

        UriComponentsBuilder redirect = UriComponentsBuilder.fromUriString(redirectUri)
                .queryParam("code", code);
        if (!state.isBlank()) redirect.queryParam("state", state);
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(redirect.build().encode().toUriString()))
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.PRAGMA, "no-cache")
                .build();
    }

    @PostMapping(value = "/api/v1/mcp/oauth/token", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> token(
            @RequestParam("grant_type") String grantType,
            @RequestParam("client_id") String clientId,
            @RequestParam(value = "code", required = false) String code,
            @RequestParam(value = "redirect_uri", required = false) String redirectUri,
            @RequestParam(value = "code_verifier", required = false) String codeVerifier,
            @RequestParam(value = "refresh_token", required = false) String refreshToken,
            @RequestParam(value = "scope", required = false) String scope) {
        try {
            McpOAuthService.TokenPair pair = switch (grantType) {
                case "authorization_code" -> oauthService.exchangeAuthorizationCode(clientId, code, redirectUri, codeVerifier);
                case "refresh_token" -> oauthService.refresh(clientId, refreshToken, scope);
                default -> throw new UnsupportedGrantTypeException();
            };

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("access_token", pair.accessToken());
            response.put("token_type", "Bearer");
            response.put("expires_in", pair.expiresIn());
            response.put("refresh_token", pair.refreshToken());
            response.put("scope", pair.scope());
            return noStore(ResponseEntity.ok(response));
        } catch (UnsupportedGrantTypeException ex) {
            return oauthJsonError(HttpStatus.BAD_REQUEST, "unsupported_grant_type", "Unsupported grant_type");
        } catch (IllegalArgumentException ex) {
            return oauthJsonError(HttpStatus.BAD_REQUEST, "invalid_grant", ex.getMessage());
        }
    }

    private String validateAuthorizationRequest(
            String clientId,
            String redirectUri,
            String responseType,
            String codeChallenge,
            String codeChallengeMethod,
            String resource) {
        if (!"code".equals(responseType)) return "Поддерживается только response_type=code.";
        if (!oauthService.isRedirectUriAllowed(clientId, redirectUri)) return "Неизвестный OAuth client или redirect_uri.";
        if (codeChallenge == null || codeChallenge.isBlank()) return "ChatGPT не передал PKCE code_challenge.";
        if (!"S256".equals(codeChallengeMethod)) return "Поддерживается только PKCE S256.";
        if (resource != null && !resource.isBlank() && !mcpResource().equals(stripTrailingSlash(resource))) {
            return "OAuth resource не соответствует Mindcrafti MCP endpoint.";
        }
        return null;
    }

    private User authenticate(String identifier, String password) {
        if (identifier == null || identifier.isBlank() || password == null) return null;
        String normalized = identifier.trim();
        User user = userRepository.findByEmail(normalized.toLowerCase(Locale.ROOT))
                .or(() -> userRepository.findByUsernameIgnoreCase(normalized))
                .orElse(null);
        if (user == null || user.isArchived() || user.getPasswordHash() == null) return null;
        return passwordEncoder.matches(password, user.getPasswordHash()) ? user : null;
    }

    private String mcpResource() {
        return publicBaseUrl + "/api/v1/mcp";
    }

    private ResponseEntity<String> html(HttpStatus status, String body) {
        return ResponseEntity.status(status)
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.PRAGMA, "no-cache")
                .body(body);
    }

    private String loginPage(
            String clientId,
            String redirectUri,
            String scope,
            String state,
            String codeChallenge,
            String resource,
            String error) {
        String errorHtml = error == null ? "" : "<p><strong>" + escapeHtml(error) + "</strong></p>";
        return "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<title>Вход в Mindcrafti</title></head><body>" +
                "<main><h1>Mindcrafti</h1><p>Войдите в аккаунт школы, чтобы разрешить ChatGPT работать с вашими уроками.</p>" +
                errorHtml +
                "<form method=\"post\" action=\"/api/v1/mcp/oauth/authorize\">" +
                hidden("client_id", clientId) + hidden("redirect_uri", redirectUri) + hidden("scope", scope) +
                hidden("state", state) + hidden("code_challenge", codeChallenge) + hidden("resource", resource) +
                "<p><label>Логин или email<br><input name=\"identifier\" autocomplete=\"username\" required></label></p>" +
                "<p><label>Пароль<br><input type=\"password\" name=\"password\" autocomplete=\"current-password\" required></label></p>" +
                "<p><button type=\"submit\">Разрешить ChatGPT</button></p>" +
                "</form><p>Доступ получают только администраторы и преподаватели Mindcrafti.</p></main></body></html>";
    }

    private static String errorPage(String message) {
        return "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><title>Mindcrafti OAuth</title></head>" +
                "<body><h1>Не удалось авторизовать ChatGPT</h1><p>" + escapeHtml(message) + "</p></body></html>";
    }

    private static String hidden(String name, String value) {
        return "<input type=\"hidden\" name=\"" + escapeHtml(name) + "\" value=\"" + escapeHtml(value == null ? "" : value) + "\">";
    }

    private static String escapeHtml(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().filter(item -> item instanceof String).map(item -> ((String) item).trim()).filter(item -> !item.isBlank()).toList();
    }

    private static String string(Object value) {
        return value instanceof String text ? text.trim() : "";
    }

    private static String stripTrailingSlash(String value) {
        if (value == null) return "";
        String result = value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private static <T> ResponseEntity<T> noStore(ResponseEntity<T> response) {
        return ResponseEntity.status(response.getStatusCode())
                .headers(headers -> headers.putAll(response.getHeaders()))
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.PRAGMA, "no-cache")
                .body(response.getBody());
    }

    private static ResponseEntity<Map<String, Object>> oauthJsonError(HttpStatus status, String error, String description) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", error);
        body.put("error_description", description == null ? error : description);
        return ResponseEntity.status(status)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.PRAGMA, "no-cache")
                .body(body);
    }

    private static final class UnsupportedGrantTypeException extends RuntimeException {}
}
