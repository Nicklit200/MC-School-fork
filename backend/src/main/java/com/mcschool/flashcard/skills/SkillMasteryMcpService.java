package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@Service
public class SkillMasteryMcpService {
    public static final Set<String> TOOL_NAMES = Set.of(
            "get_skill_mastery", "get_skill_mastery_history", "update_skill_mastery");

    private final SkillMasteryService mastery;
    private final ObjectMapper mapper;

    public SkillMasteryMcpService(SkillMasteryService mastery, ObjectMapper mapper) {
        this.mastery = mastery;
        this.mapper = mapper;
    }

    public static List<Map<String,Object>> definitions() {
        Map<String,Object> board = Map.of("type","string","description","Board ID. Omit for grade-6.");
        Map<String,Object> student = Map.of("type","string","description","Student UUID, normally returned by find_students.");
        Map<String,Object> skill = Map.of("type","string","description","Stable skill node ID from get_skill_board.");

        Map<String,Object> readProps = new LinkedHashMap<>();
        readProps.put("boardId", board);
        readProps.put("studentId", student);

        Map<String,Object> historyProps = new LinkedHashMap<>(readProps);
        historyProps.put("skillId", skill);

        Map<String,Object> evidenceItem = new LinkedHashMap<>();
        evidenceItem.put("type", "object");
        evidenceItem.put("properties", Map.ofEntries(
                Map.entry("sourceType", Map.of(
                        "type","string",
                        "enum",List.of("homework","card_session","lesson_transcript","manual_check","assessment","other"),
                        "description","Kind of evidence.")),
                Map.entry("sourceId", Map.of("type","string","description","Stable source ID when available, e.g. homework UUID, card-session UUID or Drive file ID.")),
                Map.entry("sourceTitle", Map.of("type","string","description","Human-readable source title, for example Homework 2026-10-02 or Melissa lesson transcript 2026-08-18.")),
                Map.entry("sourceDate", Map.of("type","string","description","Evidence date, normally YYYY-MM-DD.")),
                Map.entry("link", Map.of("type","string","description","Direct link when available.")),
                Map.entry("observation", Map.of("type","string","description","Concrete observation: task/question and what happened.")),
                Map.entry("studentAnswer", Map.of("type","string","description","Student answer when applicable.")),
                Map.entry("correctAnswer", Map.of("type","string","description","Correct answer when applicable.")),
                Map.entry("result", Map.of("type","string","description","Result such as CORRECT, WRONG, PARTIAL or OBSERVED.")),
                Map.entry("impact", Map.of("type","string","description","Why this evidence raises, lowers or limits mastery."))
        ));
        evidenceItem.put("required", List.of("sourceType","sourceTitle","observation"));
        evidenceItem.put("additionalProperties", false);

        Map<String,Object> writeProps = new LinkedHashMap<>(historyProps);
        writeProps.put("mastery", Map.of(
                "type","integer","minimum",0,"maximum",100,
                "description","Mastery percentage from 0 to 100."));
        writeProps.put("reason", Map.of(
                "type","string",
                "description","Short evidence-based explanation of why this exact percentage is appropriate."));
        writeProps.put("evidence", Map.of(
                "type","array","minItems",1,"maxItems",30,
                "items",evidenceItem,
                "description","Concrete evidence supporting the change. Never save a percentage without evidence."));

        return List.of(
            definition("get_skill_mastery",
                "Read saved mastery percentages for one Mindcrafti student. The response also marks whether the current percentage of each skill has evidence. Missing skill IDs mean 0% / not assessed. Read the shared curriculum separately with get_skill_board.",
                readProps, List.of("studentId"), true),
            definition("get_skill_mastery_history",
                "Read the full evidence trail for one student's concrete skill: every old/new percentage, reason, evidence items, time and editor. Use this to explain where a percentage came from before changing it.",
                historyProps, List.of("studentId","skillId"), true),
            definition("update_skill_mastery",
                "Save one student's percentage for one concrete skill WITH mandatory evidence. Before writing, inspect the relevant homework/card/session/transcript. Each evidence item must identify its source and concrete observation. Homework completion by itself is not mastery. This updates pupil progress, not the shared curriculum.",
                writeProps, List.of("studentId","skillId","mastery","reason","evidence"), false)
        );
    }

    public Map<String,Object> call(String name, Map<String,Object> args, User caller) {
        try {
            if (!TOOL_NAMES.contains(name)) throw bad("Unknown mastery tool");
            requireUser(caller);

            Set<String> allowed = switch (name) {
                case "get_skill_mastery" -> Set.of("boardId","studentId");
                case "get_skill_mastery_history" -> Set.of("boardId","studentId","skillId");
                default -> Set.of("boardId","studentId","skillId","mastery","reason","evidence");
            };
            keys(args, allowed);

            String boardId = text(args,"boardId","grade-6");
            UUID studentId = uuid(text(args,"studentId",null),"studentId");
            AuthenticatedUser principal = new AuthenticatedUser(caller.getId(), caller.getEmail(), caller.getRole());

            if (name.equals("get_skill_mastery")) {
                return result(Map.of(
                        "snapshot", mastery.get(boardId,studentId,principal),
                        "source","mindcrafti_database",
                        "pagePath","/skills"), false);
            }

            String skillId = text(args,"skillId",null);
            if (name.equals("get_skill_mastery_history")) {
                return result(Map.of(
                        "studentId",studentId,
                        "skillId",skillId,
                        "history",mastery.history(boardId,studentId,skillId,principal),
                        "source","mindcrafti_database",
                        "pagePath","/skills"), false);
            }

            Object raw = args.get("mastery");
            if (!(raw instanceof Number number) || number.doubleValue() != Math.rint(number.doubleValue()))
                throw bad("mastery must be an integer from 0 to 100");
            int value = number.intValue();
            String reason = text(args,"reason",null);
            List<SkillMasteryService.Evidence> evidence = evidence(args.get("evidence"));

            var saved = mastery.update(
                    boardId, studentId, skillId, value, reason, evidence, false, principal);
            var history = mastery.history(boardId,studentId,skillId,principal);
            Object latest = history.isEmpty() ? Map.of() : history.get(0);

            return result(Map.of(
                    "saved",true,
                    "skillId",skillId,
                    "mastery",value,
                    "change",latest,
                    "snapshot",saved,
                    "source","mindcrafti_database",
                    "pagePath","/skills"), false);
        } catch (ResponseStatusException ex) {
            int status=ex.getStatusCode().value();
            String code=status==403?"FORBIDDEN":status==404?"NOT_FOUND":"INVALID_SKILL_MASTERY";
            return result(Map.of(
                    "saved",false,
                    "errorCode",code,
                    "message",ex.getReason()==null?code:ex.getReason()), true);
        } catch (IllegalArgumentException ex) {
            return result(Map.of(
                    "saved",false,
                    "errorCode","INVALID_SKILL_MASTERY",
                    "message",ex.getMessage()==null?"Invalid mastery update":ex.getMessage()), true);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<SkillMasteryService.Evidence> evidence(Object raw) {
        if (!(raw instanceof List<?> list) || list.isEmpty())
            throw bad("evidence must contain at least one item");
        ArrayList<SkillMasteryService.Evidence> result = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?,?> map)) throw bad("Each evidence item must be an object");
            result.add(new SkillMasteryService.Evidence(
                    value(map,"sourceType"),
                    value(map,"sourceId"),
                    value(map,"sourceTitle"),
                    value(map,"sourceDate"),
                    value(map,"link"),
                    value(map,"observation"),
                    value(map,"studentAnswer"),
                    value(map,"correctAnswer"),
                    value(map,"result"),
                    value(map,"impact")));
        }
        return List.copyOf(result);
    }

    private static String value(Map<?,?> map, String key) {
        Object value = map.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private static Map<String,Object> definition(
            String name,
            String description,
            Map<String,Object> properties,
            List<String> required,
            boolean readOnly) {
        return Map.of(
                "name",name,
                "description",description,
                "inputSchema",Map.of(
                        "type","object",
                        "properties",properties,
                        "required",required,
                        "additionalProperties",false),
                "annotations",Map.of(
                        "readOnlyHint",readOnly,
                        "destructiveHint",!readOnly,
                        "idempotentHint",false,
                        "openWorldHint",false));
    }

    private static void requireUser(User user) {
        if (user==null || user.getId()==null || user.isArchived()
                || (user.getRole()!=Role.ADMIN && user.getRole()!=Role.TEACHER))
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Sign in with Mindcrafti OAuth as an active administrator or teacher");
    }

    private static void keys(Map<String,?> values, Set<String> allowed) {
        for (String key:values.keySet())
            if(!allowed.contains(key)) throw bad("Unsupported field: "+key);
    }

    private static String text(Map<String,?> values,String key,String fallback) {
        if(!values.containsKey(key)) return fallback;
        if(!(values.get(key) instanceof String value) || value.isBlank())
            throw bad(key+" must be a non-empty string");
        return value;
    }

    private static UUID uuid(String value,String field) {
        try { return UUID.fromString(value); }
        catch (RuntimeException ex) { throw bad(field+" must be a UUID"); }
    }

    private Map<String,Object> result(Map<String,Object> content, boolean isError) {
        return Map.of(
                "content",List.of(Map.of("type","text","text",mapper.writeValueAsString(content))),
                "structuredContent",content,
                "isError",isError);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);
    }
}
