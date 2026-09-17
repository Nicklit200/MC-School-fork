package com.mcschool.flashcard.lessons;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import tools.jackson.databind.ObjectMapper;

/**
 * Converts binary homework payloads returned by Mindcrafti MCP tools into native
 * MCP content blocks. This lets ChatGPT actually see rendered homework pages as
 * images instead of receiving an opaque base64 string inside JSON.
 */
@ControllerAdvice(assignableTypes = MindcraftiMcpController.class)
public class MindcraftiMcpContentAdvice implements ResponseBodyAdvice<Object> {

    private final ObjectMapper objectMapper;

    public MindcraftiMcpContentAdvice(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean supports(
            MethodParameter returnType,
            Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(
            Object body,
            MethodParameter returnType,
            MediaType selectedContentType,
            Class<? extends HttpMessageConverter<?>> selectedConverterType,
            ServerHttpRequest request,
            ServerHttpResponse response) {
        return transform(body);
    }

    Object transform(Object body) {
        if (!(body instanceof Map<?, ?> response)) return body;
        Object resultValue = response.get("result");
        if (!(resultValue instanceof Map<?, ?> result)) return body;
        Object structuredValue = result.get("structuredContent");
        if (!(structuredValue instanceof Map<?, ?> structured)) return body;

        if (isRenderedPagePayload(structured)) {
            replaceToolContent(result, imageContent(structured), stripPageBase64(structured));
            return body;
        }
        if (isPdfPayload(structured)) {
            replaceToolContent(result, pdfContent(structured), stripField(structured, "base64"));
        }
        return body;
    }

    private boolean isRenderedPagePayload(Map<?, ?> structured) {
        Object pagesValue = structured.get("pages");
        if (!(pagesValue instanceof List<?> pages) || pages.isEmpty()) return false;
        for (Object pageValue : pages) {
            if (!(pageValue instanceof Map<?, ?> page)) return false;
            if (!"image/png".equals(String.valueOf(page.get("mimeType")))) return false;
            if (blank(page.get("base64"))) return false;
        }
        return true;
    }

    private boolean isPdfPayload(Map<?, ?> structured) {
        return "application/pdf".equals(String.valueOf(structured.get("mimeType")))
                && !blank(structured.get("base64"))
                && !blank(structured.get("homeworkId"));
    }

    private List<Map<String, Object>> imageContent(Map<?, ?> structured) {
        Map<String, Object> metadata = stripPageBase64(structured);
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(textContent(metadata));

        Object pagesValue = structured.get("pages");
        if (pagesValue instanceof List<?> pages) {
            for (Object pageValue : pages) {
                if (!(pageValue instanceof Map<?, ?> page)) continue;
                Map<String, Object> image = new LinkedHashMap<>();
                image.put("type", "image");
                image.put("data", String.valueOf(page.get("base64")));
                image.put("mimeType", String.valueOf(page.get("mimeType")));
                content.add(image);
            }
        }
        return content;
    }

    private List<Map<String, Object>> pdfContent(Map<?, ?> structured) {
        Map<String, Object> metadata = stripField(structured, "base64");
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(textContent(metadata));

        String homeworkId = String.valueOf(structured.get("homeworkId"));
        String filename = blank(structured.get("filename"))
                ? "homework-submission.pdf"
                : String.valueOf(structured.get("filename"));
        Map<String, Object> resource = new LinkedHashMap<>();
        resource.put("uri", "mindcrafti://homeworks/" + homeworkId + "/submission/" + safeUriSegment(filename));
        resource.put("mimeType", "application/pdf");
        resource.put("blob", String.valueOf(structured.get("base64")));

        Map<String, Object> embedded = new LinkedHashMap<>();
        embedded.put("type", "resource");
        embedded.put("resource", resource);
        content.add(embedded);
        return content;
    }

    private Map<String, Object> textContent(Map<String, Object> metadata) {
        Map<String, Object> text = new LinkedHashMap<>();
        text.put("type", "text");
        try {
            text.put("text", objectMapper.writeValueAsString(metadata));
        } catch (Exception ex) {
            text.put("text", metadata.toString());
        }
        return text;
    }

    private Map<String, Object> stripPageBase64(Map<?, ?> structured) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : structured.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if (!"pages".equals(key)) {
                metadata.put(key, entry.getValue());
                continue;
            }
            List<Map<String, Object>> pageMetadata = new ArrayList<>();
            if (entry.getValue() instanceof List<?> pages) {
                for (Object pageValue : pages) {
                    if (!(pageValue instanceof Map<?, ?> page)) continue;
                    pageMetadata.add(stripField(page, "base64"));
                }
            }
            metadata.put("pages", pageMetadata);
        }
        return metadata;
    }

    private Map<String, Object> stripField(Map<?, ?> source, String field) {
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : source.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if (!field.equals(key)) copy.put(key, entry.getValue());
        }
        return copy;
    }

    @SuppressWarnings("unchecked")
    private void replaceToolContent(
            Map<?, ?> rawResult,
            List<Map<String, Object>> content,
            Map<String, Object> structuredContent) {
        Map<String, Object> result = (Map<String, Object>) rawResult;
        result.put("content", content);
        result.put("structuredContent", structuredContent);
    }

    private boolean blank(Object value) {
        return value == null || String.valueOf(value).isBlank();
    }

    private String safeUriSegment(String value) {
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }
}
