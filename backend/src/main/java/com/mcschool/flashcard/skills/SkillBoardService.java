package com.mcschool.flashcard.skills;

import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Shared curriculum, deliberately separate from any pupil mastery or grades. */
@Service
public class SkillBoardService {
    public record Node(String id, String kind, String title, String de, String description,
                       String example, String source, String color, double x, double y, boolean archived,
                       Boolean core, List<String> schoolTypes) {
        public Node(String id, String kind, String title, String de, String description,
                    String example, String source, String color, double x, double y, boolean archived) {
            this(id, kind, title, de, description, example, source, color, x, y, archived, false, null);
        }
    }
    public record Edge(String id, String source, String target, String kind) {}
    public record Board(int schemaVersion, String title, int grade, String source, List<Node> nodes, List<Edge> edges) {}
    public record Snapshot(String id, long revision, Instant updatedAt, Board data) {}
    public record SaveRequest(long expectedRevision, Board data) {}
    public record BoardSummary(String id, String title, int grade, long revision, Instant updatedAt) {}
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public SkillBoardService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc; this.mapper = mapper;
    }
    /** Returns the real persisted IDs of every curriculum board. */
    @Transactional(readOnly = true)
    public List<BoardSummary> list() {
        return jdbc.query("""
            SELECT id, data->>'title' AS title, CAST(data->>'grade' AS integer) AS grade,
                   revision, updated_at
            FROM skill_boards
            ORDER BY CAST(data->>'grade' AS integer), id
            """, (rs, row) -> new BoardSummary(rs.getString("id"), rs.getString("title"),
                rs.getInt("grade"), rs.getLong("revision"), rs.getTimestamp("updated_at").toInstant()));
    }

    @Transactional(readOnly = true)
    public Snapshot get(String id) {
        requireId(id);
        var found = jdbc.query("SELECT id, revision, updated_at, data::text FROM skill_boards WHERE id = ?",
            (rs, row) -> new Snapshot(rs.getString(1), rs.getLong(2), rs.getTimestamp(3).toInstant(),
                                     mapper.readValue(rs.getString(4), Board.class)), id);
        if (found.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Карта не найдена");
        return found.get(0);
    }
    @Transactional
    public Snapshot save(String id, SaveRequest request, UUID callerId) {
        requireId(id);
        if (request == null || request.expectedRevision() < 1) throw bad("Укажите текущую версию карты");
        validate(request.data());
        Snapshot before = get(id);
        if (before.revision() != request.expectedRevision()) throw conflict();
        Set<String> ids = new HashSet<>();
        request.data().nodes().forEach(n -> ids.add(n.id()));
        for (Node old : before.data().nodes()) {
            if (!ids.contains(old.id())) throw bad("Существующие навыки нужно архивировать, а не удалять из истории");
        }
        String serialized = mapper.writeValueAsString(request.data());
        if (serialized.length() > 2_000_000) throw bad("Карта слишком большая");
        int changed = jdbc.update("""
            UPDATE skill_boards SET data = CAST(? AS jsonb), revision = revision + 1,
                updated_at = now(), updated_by = ? WHERE id = ? AND revision = ?
            """, serialized, callerId, id, request.expectedRevision());
        if (changed != 1) throw conflict();
        jdbc.update("""
            INSERT INTO skill_board_revisions(board_id, revision, data, updated_at, updated_by)
            SELECT id, revision, data, updated_at, updated_by FROM skill_boards WHERE id = ?
            """, id);
        return get(id);
    }
    public static void validate(Board b) {
        if (b == null || b.schemaVersion() != 1) throw bad("Неподдерживаемая версия структуры");
        text(b.title(), 200, true); text(b.source(), 4000, false);
        if (b.grade() < 1 || b.grade() > 13) throw bad("Класс должен быть от 1 до 13");
        if (b.nodes() == null || b.edges() == null || b.nodes().size() > 1000 || b.edges().size() > 3000)
            throw bad("Допускается до 1000 карточек и 3000 связей");
        Set<String> ids = new HashSet<>();
        for (Node n : b.nodes()) {
            if (n == null) throw bad("Пустая карточка");
            requireId(n.id());
            if (!ids.add(n.id())) throw bad("Повторяется идентификатор карточки");
            if (n.kind() == null || !Set.of("root","topic","skill","note").contains(n.kind())) throw bad("Неизвестный тип карточки");
            text(n.title(), 200, true); text(n.de(), 300, false);
            text(n.description(), 4000, false); text(n.example(), 4000, false); text(n.source(), 4000, false);
            if (n.schoolTypes() != null) {
                Set<String> allowedSchoolTypes = Set.of(
                        "GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE",
                        "FACHOBERSCHULE","GESAMTSCHULE","WERKREALSCHULE","OTHER");
                if (n.schoolTypes().size() > allowedSchoolTypes.size()
                        || n.schoolTypes().stream().anyMatch(type -> type == null || !allowedSchoolTypes.contains(type)))
                    throw bad("Неизвестный тип школы у навыка");
            }
            if (n.color() == null || !Set.of("orange","blue","violet","teal","green").contains(n.color()))
                throw bad("Неизвестный цвет");
            if (!Double.isFinite(n.x()) || !Double.isFinite(n.y()) || Math.abs(n.x()) > 100000 || Math.abs(n.y()) > 100000)
                throw bad("Недопустимые координаты");
        }
        Set<String> edgeIds = new HashSet<>(), pairs = new HashSet<>(), parents = new HashSet<>();
        for (Edge e : b.edges()) {
            if (e == null) throw bad("Пустая связь");
            requireId(e.id());
            if (!edgeIds.add(e.id())) throw bad("Повторяется идентификатор связи");
            if (!ids.contains(e.source()) || !ids.contains(e.target())) throw bad("Связь указывает на отсутствующую карточку");
            if (e.source().equals(e.target())) throw bad("Нельзя соединить карточку с самой собой");
            if (e.kind() == null || !Set.of("contains","prerequisite").contains(e.kind())) throw bad("Неизвестный тип связи");
            if (!pairs.add(e.kind()+"|"+e.source()+"|"+e.target())) throw bad("Такая связь уже существует");
            if (e.kind().equals("contains") && !parents.add(e.target())) throw bad("У карточки может быть только один родительский раздел");
        }
        for (String kind : List.of("contains","prerequisite")) {
            Map<String,Integer> incoming = new HashMap<>();
            Map<String,List<String>> outgoing = new HashMap<>();
            ids.forEach(id -> incoming.put(id,0));
            for (Edge e : b.edges()) if (e.kind().equals(kind)) {
                incoming.compute(e.target(), (key,count) -> count+1);
                outgoing.computeIfAbsent(e.source(), key -> new ArrayList<>()).add(e.target());
            }
            ArrayDeque<String> queue = new ArrayDeque<>();
            incoming.forEach((id,count) -> { if(count==0) queue.add(id); });
            int visited=0;
            while(!queue.isEmpty()) {
                String id=queue.remove(); visited++;
                for(String next:outgoing.getOrDefault(id,List.of())) {
                    int count=incoming.compute(next,(key,value)->value-1);
                    if(count==0) queue.add(next);
                }
            }
            if(visited!=ids.size()) throw bad("Связи образуют цикл. Проверьте направление стрелки");
        }
    }
    private static void requireId(String id) {
        if(id==null || !id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,63}")) throw bad("Недопустимый идентификатор");
    }
    private static void text(String value,int max,boolean required) {
        if((required && (value==null || value.isBlank())) || (value!=null && value.length()>max))
            throw bad("Заполните название и соблюдайте ограничение длины текста");
    }
    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);
    }
    private static ResponseStatusException conflict() {
        return new ResponseStatusException(HttpStatus.CONFLICT,"Карту уже изменили в другой вкладке или через интеграцию. Сохраните JSON-копию и загрузите актуальную версию");
    }
}
