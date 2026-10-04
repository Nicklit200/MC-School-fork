package com.mcschool.flashcard.skills;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;
import com.mcschool.flashcard.skills.SkillBoardService.*;
class SkillBoardServiceTest {
    static Board seed() throws Exception {
        String sql=Files.readString(Path.of("src/main/resources/db/migration/V65__add_skill_boards.sql"));
        return JsonMapper.builder().build().readValue(sql.split("\\$seed\\$")[1],Board.class);
    }
    @Test void seedHas61SkillsAndValidRelations() throws Exception {
        Board b=seed(); SkillBoardService.validate(b);
        assertEquals(61,b.nodes().stream().filter(n->n.kind().equals("skill")).count());
    }
    @Test void rejectsInvalidTypesAndCycles() throws Exception {
        Board b=seed();var nodes=new ArrayList<>(b.nodes());var n=nodes.get(0);
        nodes.set(0,new Node(n.id(),null,n.title(),n.de(),n.description(),n.example(),n.source(),n.color(),n.x(),n.y(),false));
        assertEquals(400,assertThrows(ResponseStatusException.class,()->SkillBoardService.validate(new Board(1,b.title(),6,b.source(),nodes,b.edges()))).getStatusCode().value());
        var edges=new ArrayList<>(b.edges());edges.add(new Edge("self","skill-7-1","skill-7-1","prerequisite"));
        assertThrows(ResponseStatusException.class,()->SkillBoardService.validate(new Board(1,b.title(),6,b.source(),b.nodes(),edges)));
    }
    @Test void rejectsMultipleParents() throws Exception {
        Board b=seed();var edges=new ArrayList<>(b.edges());edges.add(new Edge("extra","topic-1","skill-7-1","contains"));
        assertThrows(ResponseStatusException.class,()->SkillBoardService.validate(new Board(1,b.title(),6,b.source(),b.nodes(),edges)));
    }
}
