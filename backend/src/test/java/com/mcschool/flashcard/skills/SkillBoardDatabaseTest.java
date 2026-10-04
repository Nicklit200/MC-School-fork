package com.mcschool.flashcard.skills;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;
import com.mcschool.flashcard.skills.SkillBoardService.*;
class SkillBoardDatabaseTest {
    JdbcTemplate jdbc; SkillBoardService service;
    @BeforeEach void isolatedTestDatabase() throws Exception {
        String url=System.getenv("SKILLS_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url!=null && url.startsWith("jdbc:postgresql://localhost:"),"Only runs against the explicitly configured local CI test database");
        jdbc=new JdbcTemplate(new DriverManagerDataSource(url,"skills_test","skills_test"));
        jdbc.execute("DROP TABLE IF EXISTS skill_board_revisions; DROP TABLE IF EXISTS skill_boards");
        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/V65__add_skill_boards.sql")));
        service=new SkillBoardService(jdbc,JsonMapper.builder().build());
    }
    @Test void persistsReloadsAuditsAndRejectsStaleRevision() {
        var first=service.get("grade-6");var b=first.data();
        var changed=new Board(1,"Edited curriculum",6,b.source(),b.nodes(),b.edges());
        var saved=service.save("grade-6",new SaveRequest(1,changed),UUID.randomUUID());
        assertEquals(2,saved.revision());assertEquals("Edited curriculum",service.get("grade-6").data().title());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM skill_board_revisions",Integer.class));
        var error=assertThrows(ResponseStatusException.class,()->service.save("grade-6",new SaveRequest(1,b),UUID.randomUUID()));
        assertEquals(409,error.getStatusCode().value());assertEquals(2,service.get("grade-6").revision());
    }
    @Test void removalRequiresArchiveAndPreservesOldSnapshots() {
        var b=service.get("grade-6").data();var target=b.nodes().get(b.nodes().size()-1);
        var nodes=b.nodes().stream().filter(n->!n.id().equals(target.id())).toList();
        var edges=b.edges().stream().filter(e->!e.source().equals(target.id())&&!e.target().equals(target.id())).toList();
        var invalid=new Board(1,b.title(),6,b.source(),nodes,edges);
        assertEquals(400,assertThrows(ResponseStatusException.class,()->service.save("grade-6",new SaveRequest(1,invalid),UUID.randomUUID())).getStatusCode().value());
        var archived=b.nodes().stream().map(n->n.id().equals(target.id())?new Node(n.id(),n.kind(),n.title(),n.de(),n.description(),n.example(),n.source(),n.color(),n.x(),n.y(),true):n).toList();
        service.save("grade-6",new SaveRequest(1,new Board(1,b.title(),6,b.source(),archived,b.edges())),UUID.randomUUID());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM skill_board_revisions WHERE revision=1",Integer.class));
        assertTrue(service.get("grade-6").data().nodes().stream().anyMatch(n->n.id().equals(target.id())&&n.archived()));
    }
}
