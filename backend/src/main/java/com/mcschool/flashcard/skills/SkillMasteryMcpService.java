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
    public static final Set<String> TOOL_NAMES = Set.of("get_skill_mastery", "update_skill_mastery");

    private final SkillMasteryService mastery;
    private final ObjectMapper mapper;

    public SkillMasteryMcpService(SkillMasteryService mastery, ObjectMapper mapper) {
        this.mastery = mastery;
        this.mapper = mapper;
    }

    public static List<Map<String,Object>> definitions() {
        Map<String,Object> board = Map.of("type","string","description","Board ID. Omit for grade-6.");
        Map<String,Object> student = Map.of("type","string","description","Student UUID, normally returned by find_students.");
        Map<String,Object> readProps = new LinkedHashMap<>();
        readProps.put("boardId", board);
        readProps.put("studentId", student);
        Map<String,Object> writeProps = new LinkedHashMap<>(readProps);
        writeProps.put("skillId", Map.of("type","string","description","Stable skill node ID from get_skill_board."));
        writeProps.put("mastery", Map.of("type","integer","minimum",0,"maximum",100,"description","Mastery percentage from 0 to 100."));
        return List.of(
            definition("get_skill_mastery",
                "Read the saved mastery percentages for one Mindcrafti student on the skills board. Missing skill IDs mean 0%. Use get_skill_board as the curriculum source and this tool only for the pupil overlay. Teachers can read their own students; admins can read all active students.",
                readProps, List.of("studentId"), true),
            definition("update_skill_mastery",
                "Save one student's percentage for one concrete skill. Use this only when the administrator/teacher explicitly asks to record or update mastery, or when they explicitly asked you to assess current evidence and save the resulting percentage. Do not turn homework completion alone into mastery. This updates pupil progress, not the shared curriculum.",
                writeProps, List.of("studentId","skillId","mastery"), false)
        );
    }

    public Map<String,Object> call(String name, Map<String,Object> args, User caller) {
        try {
            if (!TOOL_NAMES.contains(name)) throw bad("Unknown mastery tool");
            requireUser(caller);
            keys(args, name.equals("get_skill_mastery")
                    ? Set.of("boardId","studentId")
                    : Set.of("boardId","studentId","skillId","mastery"));
            String boardId = text(args,"boardId","grade-6");
            UUID studentId = uuid(text(args,"studentId",null),"studentId");
            AuthenticatedUser principal = new AuthenticatedUser(caller.getId(), caller.getEmail(), caller.getRole());
            if (name.equals("get_skill_mastery")) {
                return result(Map.of("snapshot", mastery.get(boardId,studentId,principal), "source","mindcrafti_database", "pagePath","/skills"), false);
            }
            String skillId = text(args,"skillId",null);
            Object raw = args.get("mastery");
            if (!(raw instanceof Number number) || number.doubleValue() != Math.rint(number.doubleValue()))
                throw bad("mastery must be an integer from 0 to 100");
            int value = number.intValue();
            var saved = mastery.update(boardId,studentId,skillId,value,principal);
            return result(Map.of("saved",true,"skillId",skillId,"mastery",value,"snapshot",saved,"source","mindcrafti_database","pagePath","/skills"), false);
        } catch (ResponseStatusException ex) {
            int status=ex.getStatusCode().value();
            String code=status==403?"FORBIDDEN":status==404?"NOT_FOUND":"INVALID_SKILL_MASTERY";
            return result(Map.of("saved",false,"errorCode",code,"message",ex.getReason()==null?code:ex.getReason()), true);
        } catch (IllegalArgumentException ex) {
            return result(Map.of("saved",false,"errorCode","INVALID_SKILL_MASTERY","message",ex.getMessage()==null?"Invalid mastery update":ex.getMessage()), true);
        }
    }

    private static Map<String,Object> definition(String name,String description,Map<String,Object> properties,List<String> required,boolean readOnly) {
        return Map.of("name",name,"description",description,
                "inputSchema",Map.of("type","object","properties",properties,"required",required,"additionalProperties",false),
                "annotations",Map.of("readOnlyHint",readOnly,"destructiveHint",!readOnly,"idempotentHint",true,"openWorldHint",false));
    }

    private static void requireUser(User user) {
        if (user==null || user.getId()==null || user.isArchived() || (user.getRole()!=Role.ADMIN && user.getRole()!=Role.TEACHER))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Sign in with Mindcrafti OAuth as an active administrator or teacher");
    }

    private static void keys(Map<String,?> values, Set<String> allowed) {
        for (String key:values.keySet()) if(!allowed.contains(key)) throw bad("Unsupported field: "+key);
    }

    private static String text(Map<String,?> values,String key,String fallback) {
        if(!values.containsKey(key)) return fallback;
        if(!(values.get(key) instanceof String value) || value.isBlank()) throw bad(key+" must be a non-empty string");
        return value;
    }

    private static UUID uuid(String value,String field) {
        try { return UUID.fromString(value); }
        catch (RuntimeException ex) { throw bad(field+" must be a UUID"); }
    }

    private Map<String,Object> result(Map<String,Object> content, boolean isError) {
        return Map.of("content",List.of(Map.of("type","text","text",mapper.writeValueAsString(content))),"structuredContent",content,"isError",isError);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);
    }
}
