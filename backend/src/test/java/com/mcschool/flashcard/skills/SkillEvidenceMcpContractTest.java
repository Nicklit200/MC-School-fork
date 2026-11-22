package com.mcschool.flashcard.skills;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Regression: both direct MCP and old-client bridge have explicit evidence tools. */
class SkillEvidenceMcpContractTest {
    @Test void evidenceReadAndWriteAreSeparateAndScoped() {
        var tools=SkillMasteryMcpService.definitions();
        assertTrue(SkillMasteryMcpService.TOOL_NAMES.contains("get_skill_evidence"));
        assertTrue(SkillMasteryMcpService.TOOL_NAMES.contains("record_skill_evidence"));
        var read=tools.stream().filter(t->"get_skill_evidence".equals(t.get("name")))
            .findFirst().orElseThrow();
        var write=tools.stream().filter(t->"record_skill_evidence".equals(t.get("name")))
            .findFirst().orElseThrow();
        @SuppressWarnings("unchecked")
        Map<String,Object> schema=(Map<String,Object>)write.get("inputSchema");
        @SuppressWarnings("unchecked")
        List<String> required=(List<String>)schema.get("required");
        assertTrue(required.containsAll(List.of("studentId","skillId","sourceType","sourceRef",
                "autonomy","explanation","observedAt","idempotencyKey")));
        assertFalse(required.contains("masteryAfter")); // evidence may not justify a percentage update
        @SuppressWarnings("unchecked")
        Map<String,Object> readFlags=(Map<String,Object>)read.get("annotations");
        @SuppressWarnings("unchecked")
        Map<String,Object> writeFlags=(Map<String,Object>)write.get("annotations");
        assertEquals(true,readFlags.get("readOnlyHint"));
        assertEquals(false,writeFlags.get("readOnlyHint"));
        assertEquals(4,tools.size());
    }
}
