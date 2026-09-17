package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class MindcraftiMcpContentAdviceTest {

    private final MindcraftiMcpContentAdvice advice = new MindcraftiMcpContentAdvice(new ObjectMapper());

    @Test
    void turnsRenderedPagesIntoNativeMcpImageContent() {
        Map<String, Object> page = new LinkedHashMap<>();
        page.put("pageNumber", 1);
        page.put("mimeType", "image/png");
        page.put("base64", "iVBORw0KGgoAAA");

        Map<String, Object> structured = new LinkedHashMap<>();
        structured.put("homeworkId", "homework-1");
        structured.put("totalPageCount", 1);
        structured.put("pages", List.of(page));

        Map<String, Object> toolResult = new LinkedHashMap<>();
        toolResult.put("content", List.of(Map.of("type", "text", "text", "old")));
        toolResult.put("structuredContent", structured);
        toolResult.put("isError", false);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", 1);
        response.put("result", toolResult);

        advice.transform(response);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> content = (List<Map<String, Object>>) toolResult.get("content");
        assertThat(content).hasSize(2);
        assertThat(content.get(0).get("type")).isEqualTo("text");
        assertThat(content.get(1).get("type")).isEqualTo("image");
        assertThat(content.get(1).get("mimeType")).isEqualTo("image/png");
        assertThat(content.get(1).get("data")).isEqualTo("iVBORw0KGgoAAA");

        @SuppressWarnings("unchecked")
        Map<String, Object> safeStructured = (Map<String, Object>) toolResult.get("structuredContent");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> safePages = (List<Map<String, Object>>) safeStructured.get("pages");
        assertThat(safePages.get(0)).doesNotContainKey("base64");
    }

    @Test
    void turnsSubmittedPdfIntoEmbeddedMcpResource() {
        Map<String, Object> structured = new LinkedHashMap<>();
        structured.put("homeworkId", "abc-123");
        structured.put("filename", "submitted homework.pdf");
        structured.put("mimeType", "application/pdf");
        structured.put("base64", "JVBERi0xLjcK");

        Map<String, Object> toolResult = new LinkedHashMap<>();
        toolResult.put("content", List.of(Map.of("type", "text", "text", "old")));
        toolResult.put("structuredContent", structured);
        toolResult.put("isError", false);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("jsonrpc", "2.0");
        response.put("id", 1);
        response.put("result", toolResult);

        advice.transform(response);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> content = (List<Map<String, Object>>) toolResult.get("content");
        assertThat(content).hasSize(2);
        assertThat(content.get(1).get("type")).isEqualTo("resource");

        @SuppressWarnings("unchecked")
        Map<String, Object> resource = (Map<String, Object>) content.get(1).get("resource");
        assertThat(resource.get("mimeType")).isEqualTo("application/pdf");
        assertThat(resource.get("blob")).isEqualTo("JVBERi0xLjcK");
        assertThat(resource.get("uri")).isEqualTo("mindcrafti://homeworks/abc-123/submission/submitted_homework.pdf");

        @SuppressWarnings("unchecked")
        Map<String, Object> safeStructured = (Map<String, Object>) toolResult.get("structuredContent");
        assertThat(safeStructured).doesNotContainKey("base64");
    }
}
