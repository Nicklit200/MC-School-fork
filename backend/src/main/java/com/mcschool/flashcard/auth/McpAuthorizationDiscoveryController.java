package com.mcschool.flashcard.auth;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Compatibility aliases for OAuth/OIDC discovery paths probed by MCP clients.
 * The canonical metadata is still rooted at /.well-known/oauth-authorization-server,
 * but ChatGPT also probes resource-relative and OpenID-style locations while scanning.
 */
@RestController
public class McpAuthorizationDiscoveryController {

    private final String publicBaseUrl;

    public McpAuthorizationDiscoveryController(
            @Value("${MINDCRAFTI_PUBLIC_BASE_URL:https://mindcrafti-school-production.up.railway.app}") String publicBaseUrl) {
        this.publicBaseUrl = stripTrailingSlash(publicBaseUrl);
    }

    @GetMapping(value = {
            "/.well-known/oauth-authorization-server/api/v1/mcp",
            "/api/v1/mcp/.well-known/oauth-authorization-server",
            "/.well-known/openid-configuration",
            "/.well-known/openid-configuration/api/v1/mcp",
            "/api/v1/mcp/.well-known/openid-configuration"
    }, produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> authorizationServerMetadataAliases() {
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

    private static String stripTrailingSlash(String value) {
        if (value == null) return "";
        String result = value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }
}
