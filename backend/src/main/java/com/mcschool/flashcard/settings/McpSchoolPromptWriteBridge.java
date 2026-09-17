package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;
import tools.jackson.databind.ObjectMapper;

/**
 * Exposes an ADMIN-only MCP write tool for the administrator-managed school
 * prompts while keeping the existing lesson MCP controller unchanged.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class McpSchoolPromptWriteBridge extends OncePerRequestFilter {

    private static final String MCP_PATH = "/api/v1/mcp";
    private static final String TOOL_NAME = "update_school_prompt";
    private static final int MAX_PROMPT_LENGTH = 30000;
    private static final int REQUEST_CACHE_LIMIT = 65536;

    private final ObjectMapper objectMapper;
    private final McpOAuthService oauthService;
    private final SchoolPromptSettingsService promptSettingsService;

    public McpSchoolPromptWriteBridge(
            ObjectMapper objectMapper,
            McpOAuthService oauthService,
            SchoolPromptSettingsService promptSettingsService) {
        this.objectMapper = objectMapper;
        this.oauthService = oauthService;
        this.promptSettingsService = promptSettingsService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !MCP_PATH.equals(request.getRequestURI())
                || !"POST".equalsIgnoreCase(request.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        ContentCachingRequestWrapper requestWrapper = new ContentCachingRequestWrapper(request, REQUEST_CACHE_LIMIT);
        ContentCachingResponseWrapper responseWrapper = new ContentCachingResponseWrapper(response);

        filterChain.doFilter(requestWrapper, responseWrapper);

        byte[] requestBytes = requestWrapper.getContentAsByteArray();
        if (requestBytes.length == 0) {
            responseWrapper.copyBodyToResponse();
            return;
        }

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> rpcRequest = objectMapper.readValue(requestBytes, Map.class);
            String method = string(rpcRequest.get("method"));

            if ("tools/list".equals(method) && isAdminOAuth(request)) {
                byte[] augmented = augmentToolList(responseWrapper.getContentAsByteArray());
                if (augmented != null) replaceResponse(responseWrapper, augmented);
                responseWrapper.copyBodyToResponse();
                return;
            }

            if ("tools/call".equals(method) && TOOL_NAME.equals(toolName(rpcRequest))) {
                replaceResponse(responseWrapper, handleUpdateCall(rpcRequest, request));
                responseWrapper.copyBodyToResponse();
                return;
            }
        } catch (Exception ignored) {
            // If augmentation fails, preserve the existing MCP response.
        }

        responseWrapper.copyBodyToResponse();
    }

    private byte[] augmentToolList(byte[] responseBytes) throws Exception {
        if (responseBytes == null || responseBytes.length == 0) return null;

        @SuppressWarnings("unchecked")
        Map<String, Object> envelope = objectMapper.readValue(responseBytes, Map.class);
        Map<String, Object> result = map(envelope.get("result"));
        Object toolsValue = result.get("tools");
        if (!(toolsValue instanceof List<?> existingTools)) return null;

        for (Object item : existingTools) {
            if (TOOL_NAME.equals(string(map(item).get("name")))) return null;
        }

        List<Object> tools = new ArrayList<>(existingTools);
        tools.add(updateToolDefinition());

        Map<String, Object> mutableResult = new LinkedHashMap<>(result);
        mutableResult.put("tools", tools);
        Map<String, Object> mutableEnvelope = new LinkedHashMap<>(envelope);
        mutableEnvelope.put("result", mutableResult);
        return objectMapper.writeValueAsBytes(mutableEnvelope);
    }

    private Map<String, Object> updateToolDefinition() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("lessonType", property("Prompt type to replace: group or individual."));
        properties.put("prompt", property("Complete replacement prompt text. Maximum 30000 characters."));

        Map<String, Object> inputSchema = new LinkedHashMap<>();
        inputSchema.put("type", "object");
        inputSchema.put("properties", properties);
        inputSchema.put("required", List.of("lessonType", "prompt"));
        inputSchema.put("additionalProperties", false);

        Map<String, Object> tool = new LinkedHashMap<>();
        tool.put("name", TOOL_NAME);
        tool.put("description",
                "Admin-only. Replace one administrator-managed Mindcrafti school prompt while preserving the other prompt. Use this when the administrator explicitly asks to change or save the group or individual school prompt.");
        tool.put("inputSchema", inputSchema);
        tool.put("annotations", Map.of(
                "readOnlyHint", false,
                "destructiveHint", false,
                "idempotentHint", true,
                "openWorldHint", false));
        return tool;
    }

    private Map<String, Object> property(String description) {
        return Map.of("type", "string", "description", description);
    }

    private byte[] handleUpdateCall(Map<String, Object> rpcRequest, HttpServletRequest request) throws Exception {
        Object id = rpcRequest.get("id");
        try {
            User admin = resolveOauthUser(request);
            if (admin == null || admin.getRole() != Role.ADMIN) {
                throw new IllegalArgumentException("Admin role required");
            }

            Map<String, Object> params = map(rpcRequest.get("params"));
            Map<String, Object> arguments = map(params.get("arguments"));
            String lessonType = normalize(required(arguments, "lessonType"));
            if (!arguments.containsKey("prompt") || arguments.get("prompt") == null) {
                throw new IllegalArgumentException("prompt is required");
            }
            String prompt = String.valueOf(arguments.get("prompt"));
            if (prompt.length() > MAX_PROMPT_LENGTH) {
                throw new IllegalArgumentException("prompt exceeds 30000 characters");
            }

            SchoolPromptSettingsResponse current = promptSettingsService.readForMcp();
            String groupPrompt = current.groupLessonPrompt() == null ? "" : current.groupLessonPrompt();
            String individualPrompt = current.individualLessonPrompt() == null ? "" : current.individualLessonPrompt();

            if ("group".equals(lessonType)) groupPrompt = prompt;
            else if ("individual".equals(lessonType)) individualPrompt = prompt;
            else throw new IllegalArgumentException("lessonType must be group or individual");

            AuthenticatedUser caller = new AuthenticatedUser(admin.getId(), admin.getEmail(), admin.getRole());
            SchoolPromptSettingsResponse updated = promptSettingsService.update(
                    caller,
                    new UpdateSchoolPromptSettingsRequest(groupPrompt, individualPrompt));

            String savedPrompt = "group".equals(lessonType)
                    ? updated.groupLessonPrompt()
                    : updated.individualLessonPrompt();

            Map<String, Object> structured = new LinkedHashMap<>();
            structured.put("lessonType", lessonType);
            structured.put("prompt", savedPrompt == null ? "" : savedPrompt);
            structured.put("updatedAt", updated.updatedAt() == null ? null : updated.updatedAt().toString());
            structured.put("configured", savedPrompt != null && !savedPrompt.isBlank());

            Map<String, Object> toolResult = new LinkedHashMap<>();
            toolResult.put("content", List.of(Map.of(
                    "type", "text",
                    "text", objectMapper.writeValueAsString(structured))));
            toolResult.put("structuredContent", structured);
            toolResult.put("isError", false);

            Map<String, Object> success = new LinkedHashMap<>();
            success.put("jsonrpc", "2.0");
            success.put("id", id);
            success.put("result", toolResult);
            return objectMapper.writeValueAsBytes(success);
        } catch (IllegalArgumentException ex) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("jsonrpc", "2.0");
            error.put("id", id);
            error.put("error", Map.of(
                    "code", -32602,
                    "message", ex.getMessage() == null ? "Invalid arguments" : ex.getMessage()));
            return objectMapper.writeValueAsBytes(error);
        }
    }

    private String toolName(Map<String, Object> rpcRequest) {
        return string(map(rpcRequest.get("params")).get("name"));
    }

    private boolean isAdminOAuth(HttpServletRequest request) {
        User user = resolveOauthUser(request);
        return user != null && user.getRole() == Role.ADMIN;
    }

    private User resolveOauthUser(HttpServletRequest request) {
        String authorization = string(request.getHeader(HttpHeaders.AUTHORIZATION)).trim();
        if (!authorization.regionMatches(true, 0, "Bearer ", 0, 7)) return null;
        String bearer = authorization.substring(7).trim();
        if (bearer.isBlank()) return null;
        return oauthService.resolveAccessToken(bearer).orElse(null);
    }

    private void replaceResponse(ContentCachingResponseWrapper response, byte[] body) throws IOException {
        response.resetBuffer();
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentLength(body.length);
        response.getOutputStream().write(body);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        if (value instanceof Map<?, ?> raw) return (Map<String, Object>) raw;
        return Map.of();
    }

    private String required(Map<String, Object> values, String key) {
        String value = string(values.get(key));
        if (value.isBlank()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private String normalize(String value) {
        return string(value).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private String string(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
