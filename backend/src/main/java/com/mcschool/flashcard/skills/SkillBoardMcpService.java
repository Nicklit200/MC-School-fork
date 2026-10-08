package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import static com.mcschool.flashcard.skills.SkillBoardService.*;

/** Narrow, revision-checked curriculum edits. Never changes pupil results. */
@Service
public class SkillBoardMcpService {
    public static final Set<String> TOOL_NAMES = Set.of("list_skill_boards", "get_skill_board", "edit_skill_board");
    private static final Set<String> NODE_FIELDS = Set.of("kind", "title", "de", "description", "example", "source", "color", "x", "y", "archived");
    private final SkillBoardService boards;
    private final ObjectMapper mapper;

    public SkillBoardMcpService(SkillBoardService boards, ObjectMapper mapper) {
        this.boards = boards;
        this.mapper = mapper;
    }

    public static List<Map<String, Object>> definitions() {
        var boardProperty = Map.of("type", "string", "description", "Board ID. Omit for grade-6, the existing grade-six curriculum. Read current data before editing.");
        var list = definition("list_skill_boards",
            "List all existing Mindcrafti curriculum skills boards with their actual persisted IDs, grade, title, revision and update time. Call this before get_skill_board to select the correct class; never guess board IDs.",
            Map.of(), List.of(), true);
        var read = definition("get_skill_board",
            "Read the live Mindcrafti curriculum skills board from the same database used by /skills. Returns stable node/edge IDs, current revision, descriptions, examples, prerequisite and containment arrows, and canvas positions. OAuth ADMIN or TEACHER only. This is a curriculum catalog, NOT evidence of pupil mastery. Fetch fresh before edits; never reconstruct the current board from chat memory.",
            Map.of("boardId", boardProperty), List.of(), true);
        var editProperties = new LinkedHashMap<String, Object>();
        editProperties.put("boardId", boardProperty);
        editProperties.put("expectedRevision", Map.of("type", "integer", "minimum", 1, "description", "Exact revision returned by the latest get_skill_board. A stale revision is rejected without writing. Read again and reconcile; never blindly retry with a new number."));
        editProperties.put("operationsJson", Map.of("type", "string", "description",
            "JSON array of 1-100 explicit edits, applied atomically. Supported shapes: {op:'add_node',node:{id?:string,kind?:'skill'|'topic'|'note',title:string,de?:string,description?:string,example?:string,source?:string,color?:'orange'|'blue'|'violet'|'teal'|'green',x?:number,y?:number},parentId?:string}; {op:'update_node',id:string,fields:{title?:string,de?:string,description?:string,example?:string,source?:string,kind?:string,color?:string,x?:number,y?:number,archived?:boolean}}; {op:'set_parent',id:string,parentId:string}; {op:'add_edge',id?:string,source:string,target:string,kind:'contains'|'prerequisite'}; {op:'remove_edge',id:string}. Use valid JSON with double quotes. To remove/restore a card, update archived=true/false; permanent node deletion is not supported. A prerequisite arrow points FROM the needed skill TO the later skill. A contains arrow points FROM section TO child. Use IDs from the live read; preserve unrelated fields and positions. New IDs may be supplied to reference new nodes within the same batch. No percentages or pupil results belong in this catalog."));
        var edit = definition("edit_skill_board",
            "Save explicitly requested changes to the live Mindcrafti skills board. OAuth ADMIN only; preserves existing node IDs, unrelated content, audit snapshots and database revision-conflict protection. Use only for the user's requested curriculum/board edits, not to infer or record pupil mastery. Read with get_skill_board first. No change is saved on error. Read back after success. Editing updates the same board visible at /skills; an already open browser must reload after saving its own draft.",
            editProperties, List.of("expectedRevision", "operationsJson"), false);
        return List.of(list, read, edit);
    }

    private static Map<String, Object> definition(String name, String description, Map<String, ?> properties, List<String> required, boolean readOnly) {
        return Map.of("name", name, "description", description,
            "inputSchema", Map.of("type", "object", "properties", properties, "required", required, "additionalProperties", false),
            "annotations", Map.of("readOnlyHint", readOnly, "destructiveHint", !readOnly, "idempotentHint", true, "openWorldHint", false));
    }

    /** Returns MCP-level tool errors rather than misleading successful tool results. */
    public Map<String, Object> call(String name, Map<String, Object> args, User caller) {
        try {
            if (!TOOL_NAMES.contains(name)) throw bad("Unknown skills tool");
            requireReader(caller);
            if (name.equals("edit_skill_board") && caller.getRole() != Role.ADMIN)
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only a signed-in administrator can edit the shared curriculum");
            keys(args, name.equals("list_skill_boards") ? Set.of() : name.equals("get_skill_board") ? Set.of("boardId") : Set.of("boardId", "expectedRevision", "operationsJson"));
            if (name.equals("list_skill_boards")) return result(Map.of("boards", boards.list(), "source", "mindcrafti_database", "pagePath", "/skills"), false);
            String boardId = text(args, "boardId", "grade-6");
            if (name.equals("get_skill_board")) return result(Map.of("board", boards.get(boardId), "canEdit", caller.getRole() == Role.ADMIN, "source", "mindcrafti_database", "pagePath", "/skills"), false);
            return result(edit(boardId, args, caller), false);
        } catch (ResponseStatusException ex) {
            int status = ex.getStatusCode().value();
            String code = status == 409 ? "REVISION_CONFLICT" : status == 403 ? "FORBIDDEN" : status == 404 ? "NOT_FOUND" : "INVALID_SKILL_EDIT";
            return result(Map.of("saved", false, "errorCode", code, "message", ex.getReason() == null ? code : ex.getReason()), true);
        } catch (IllegalArgumentException ex) {
            return result(Map.of("saved", false, "errorCode", "INVALID_SKILL_EDIT", "message", ex.getMessage() == null ? "Invalid edit" : ex.getMessage()), true);
        }
    }

    private Map<String, Object> edit(String boardId, Map<String, Object> args, User caller) {
        Object rawRevision = args.get("expectedRevision");
        if (!(rawRevision instanceof Number number)) throw bad("expectedRevision must be an integer from get_skill_board");
        long expected = number.longValue();
        if (expected < 1 || number.doubleValue() != (double) expected) throw bad("Invalid expectedRevision");
        String json = text(args, "operationsJson", null);
        if (json == null || json.isBlank() || json.length() > 300_000) throw bad("Provide a JSON array of edits, at most 300000 characters");
        Object parsed;
        try { parsed = mapper.readValue(json, Object.class); }
        catch (RuntimeException ex) { throw bad("operationsJson is not valid JSON"); }
        if (!(parsed instanceof List<?> operations) || operations.isEmpty() || operations.size() > 100)
            throw bad("Provide between 1 and 100 operations");
        Snapshot before = boards.get(boardId);
        if (before.revision() != expected) throw new ResponseStatusException(HttpStatus.CONFLICT, "The board has changed. Read get_skill_board again and reconcile the requested edits; nothing was saved.");
        var nodes = new LinkedHashMap<String, Node>();
        var edges = new LinkedHashMap<String, Edge>();
        before.data().nodes().forEach(n -> nodes.put(n.id(), n));
        before.data().edges().forEach(e -> edges.put(e.id(), e));
        for (Object raw : operations) {
            Map<String, Object> op = object(raw);
            String action = text(op, "op", "");
            switch (action) {
                case "add_node" -> {
                    keys(op, Set.of("op", "node", "parentId"));
                    Map<String, Object> fields = new LinkedHashMap<>(object(op.get("node")));
                    String id = text(fields, "id", "node_" + UUID.randomUUID());
                    fields.remove("id");
                    if (nodes.containsKey(id)) throw bad("Node ID already exists: " + id);
                    Node base = new Node(id, "skill", "", "", "", "", "", "blue", 600, 300, false);
                    Node added = update(base, fields);
                    if (added.kind().equals("root")) throw bad("Adding another curriculum root is not supported");
                    nodes.put(id, added);
                    if (op.containsKey("parentId")) setParent(nodes, edges, id, text(op, "parentId", null));
                }
                case "update_node" -> {
                    keys(op, Set.of("op", "id", "fields"));
                    String id = text(op, "id", null);
                    Node old = existing(nodes, id);
                    Node updated = update(old, object(op.get("fields")));
                    if (old.kind().equals("root") && (updated.archived() || !updated.kind().equals("root")))
                        throw bad("The curriculum root cannot be archived or converted");
                    if (!old.kind().equals("root") && updated.kind().equals("root")) throw bad("Cannot create another root");
                    nodes.put(id, updated);
                }
                case "set_parent" -> {
                    keys(op, Set.of("op", "id", "parentId"));
                    setParent(nodes, edges, text(op, "id", null), text(op, "parentId", null));
                }
                case "add_edge" -> {
                    keys(op, Set.of("op", "id", "source", "target", "kind"));
                    String source = text(op, "source", null), target = text(op, "target", null);
                    existing(nodes, source); existing(nodes, target);
                    String id = text(op, "id", "edge_" + UUID.randomUUID());
                    if (edges.containsKey(id)) throw bad("Edge ID already exists: " + id);
                    edges.put(id, new Edge(id, source, target, text(op, "kind", "prerequisite")));
                }
                case "remove_edge" -> {
                    keys(op, Set.of("op", "id"));
                    String id = text(op, "id", null);
                    if (edges.remove(id) == null) throw bad("Edge not found: " + id);
                }
                default -> throw bad("Unsupported operation: " + action);
            }
        }
        Board old = before.data();
        Board next = new Board(old.schemaVersion(), old.title(), old.grade(), old.source(), List.copyOf(nodes.values()), List.copyOf(edges.values()));
        SkillBoardService.validate(next);
        if (old.equals(next)) return Map.of("saved", false, "unchanged", true, "board", before, "source", "mindcrafti_database");
        Snapshot saved = boards.save(boardId, new SaveRequest(expected, next), caller.getId());
        return Map.of("saved", true, "operationCount", operations.size(), "board", saved, "source", "mindcrafti_database", "pagePath", "/skills");
    }

    private static Node update(Node n, Map<String, Object> fields) {
        keys(fields, NODE_FIELDS);
        if (fields.isEmpty()) throw bad("Node fields cannot be empty");
        boolean archived = n.archived();
        if (fields.containsKey("archived")) {
            if (!(fields.get("archived") instanceof Boolean value)) throw bad("archived must be boolean");
            archived = value;
        }
        return new Node(n.id(), text(fields,"kind",n.kind()), text(fields,"title",n.title()), text(fields,"de",n.de()),
            text(fields,"description",n.description()), text(fields,"example",n.example()), text(fields,"source",n.source()),
            text(fields,"color",n.color()), coordinate(fields,"x",n.x()), coordinate(fields,"y",n.y()), archived);
    }

    private static void setParent(Map<String, Node> nodes, Map<String, Edge> edges, String id, String parentId) {
        Node child = existing(nodes, id), parent = existing(nodes, parentId);
        if (child.kind().equals("root") || child.archived() || parent.archived()) throw bad("Cannot reparent the root or archived cards");
        if (id.equals(parentId)) throw bad("A node cannot contain itself");
        if (edges.values().stream().anyMatch(e -> e.kind().equals("contains") && e.target().equals(id) && e.source().equals(parentId))) return;
        edges.values().removeIf(e -> e.kind().equals("contains") && e.target().equals(id));
        String edgeId = "edge_" + UUID.randomUUID();
        edges.put(edgeId, new Edge(edgeId, parentId, id, "contains"));
    }

    private static Node existing(Map<String, Node> nodes, String id) {
        Node n = nodes.get(id);
        if (n == null) throw bad("Node not found: " + id);
        return n;
    }
    private static void requireReader(User user) {
        if (user == null || user.getId() == null || user.isArchived() || (user.getRole() != Role.ADMIN && user.getRole() != Role.TEACHER))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Sign in with Mindcrafti OAuth as an active administrator or teacher. Import API keys cannot access skill boards.");
    }
    private static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?> raw)) throw bad("Each operation and fields/node value must be a JSON object");
        var result = new LinkedHashMap<String, Object>();
        raw.forEach((key, item) -> { if (!(key instanceof String)) throw bad("Object keys must be strings"); result.put((String)key, item); });
        return result;
    }
    private static void keys(Map<String, ?> values, Set<String> allowed) {
        for (String key : values.keySet()) if (!allowed.contains(key)) throw bad("Unsupported field: " + key);
    }
    private static String text(Map<String, ?> values, String key, String fallback) {
        if (!values.containsKey(key)) return fallback;
        if (!(values.get(key) instanceof String value)) throw bad(key + " must be a string");
        return value;
    }
    private static double coordinate(Map<String, ?> values, String key, double fallback) {
        if (!values.containsKey(key)) return fallback;
        if (!(values.get(key) instanceof Number number) || !Double.isFinite(number.doubleValue())) throw bad(key + " must be a finite number");
        return number.doubleValue();
    }
    private Map<String, Object> result(Map<String, Object> content, boolean isError) {
        return Map.of("content", List.of(Map.of("type", "text", "text", mapper.writeValueAsString(content))), "structuredContent", content, "isError", isError);
    }
    private static ResponseStatusException bad(String text) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, text); }
}
