package com.mcschool.flashcard.skills;

import com.mcschool.flashcard.auth.McpOAuthService;
import com.mcschool.flashcard.lessons.MindcraftiMcpController;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.mcschool.flashcard.skills.SkillBoardService.*;

class SkillBoardMcpServiceTest {
    SkillBoardService boards;
    SkillBoardMcpService service;
    JsonMapper mapper;
    User admin;
    Snapshot initial;
    @BeforeEach void setup() {
        boards = mock(SkillBoardService.class); mapper = JsonMapper.builder().build();
        service = new SkillBoardMcpService(boards, mapper); admin = user(Role.ADMIN);
        var root = new Node("grade6", "root", "Grade 6", "Klasse 6", "", "", "Textbook", "orange", 0, 0, false);
        var topic = new Node("fractions", "topic", "Fractions", "Brueche", "", "", "Textbook", "blue", 300, 0, false);
        var skill = new Node("reduce", "skill", "Reduce fractions", "Kuerzen", "Find common factor", "6/8", "Chapter 7", "blue", 700, 200, false);
        var other = new Node("add", "skill", "Add fractions", "Addieren", "", "1/3+1/4", "Chapter 7", "blue", 700, 400, false);
        var board = new Board(1, "Grade 6", 6, "Draft curriculum", List.of(root, topic, skill, other),
            List.of(new Edge("r-t", "grade6", "fractions", "contains"), new Edge("t-s", "fractions", "reduce", "contains"), new Edge("t-a", "fractions", "add", "contains"), new Edge("s-a", "reduce", "add", "prerequisite")));
        initial = new Snapshot("grade-6", 3, Instant.now(), board);
        when(boards.get("grade-6")).thenReturn(initial);
        when(boards.save(eq("grade-6"), any(), eq(admin.getId()))).thenAnswer(inv -> new Snapshot("grade-6", 4, Instant.now(), ((SaveRequest) inv.getArgument(1)).data()));
    }
    User user(Role role) { User u=mock(User.class); when(u.getId()).thenReturn(UUID.randomUUID()); when(u.getRole()).thenReturn(role); return u; }
    Map<String,Object> edit(long revision, String json, User caller) { return service.call("edit_skill_board", Map.of("expectedRevision", revision, "operationsJson", json), caller); }
    Map<?,?> structured(Map<String,Object> r) { return (Map<?,?>)r.get("structuredContent"); }
    void noSave() { verify(boards, never()).save(anyString(), any(), any()); }
    @Test void readReturnsLiveRevisionAndPermissions() {
        var r=service.call("get_skill_board", Map.of(), user(Role.TEACHER));
        assertEquals(false,r.get("isError")); assertEquals(initial,structured(r).get("board")); assertEquals(false,structured(r).get("canEdit")); noSave();
    }
    @Test void rejectsAnonymousArchivedAndStudentWithoutReadingDatabase() {
        User archived=user(Role.ADMIN); when(archived.isArchived()).thenReturn(true);
        for(User u:Arrays.asList(null, archived, user(Role.STUDENT))) {
            var r=service.call("get_skill_board",Map.of(),u); assertEquals(true,r.get("isError")); assertEquals("FORBIDDEN",structured(r).get("errorCode"));
        }
        verifyNoInteractions(boards);
    }
    @Test void teacherCannotWriteAndImportApiKeyCannotWrite() {
        for(User u:Arrays.asList(user(Role.TEACHER),null)) assertEquals(true,edit(3,"[]",u).get("isError"));
        verifyNoInteractions(boards);
    }
    @Test void preservesFieldsPositionsAndUnrelatedNodesWhenRenaming() {
        var r=edit(3,"[{\"op\":\"update_node\",\"id\":\"reduce\",\"fields\":{\"title\":\"Equivalent fractions\"}}]",admin);
        assertEquals(false,r.get("isError")); assertEquals(true,structured(r).get("saved"));
        var captor=ArgumentCaptor.forClass(SaveRequest.class); verify(boards).save(eq("grade-6"),captor.capture(),eq(admin.getId()));
        var next=captor.getValue().data(); assertEquals(3,captor.getValue().expectedRevision());
        assertEquals(initial.data().nodes().get(3),next.nodes().get(3));
        assertEquals("Chapter 7",next.nodes().get(2).source()); assertEquals(700,next.nodes().get(2).x());
        assertEquals(initial.data().edges(),next.edges()); assertEquals("Equivalent fractions",next.nodes().get(2).title());
    }
    @Test void rejectsStaleRevision() {
        var r=edit(2,"[{\"op\":\"update_node\",\"id\":\"reduce\",\"fields\":{\"title\":\"X\"}}]",admin);
        assertEquals("REVISION_CONFLICT",structured(r).get("errorCode")); noSave();
    }
    @Test void createsNodeAndParentAndPrerequisiteAtomically() {
        var r=edit(3,"[{\"op\":\"add_node\",\"node\":{\"id\":\"compare\",\"title\":\"Compare\"},\"parentId\":\"fractions\"},{\"op\":\"add_edge\",\"source\":\"reduce\",\"target\":\"compare\",\"kind\":\"prerequisite\"}]",admin);
        assertEquals(false,r.get("isError")); var after=(Snapshot)structured(r).get("board");
        assertEquals(5,after.data().nodes().size()); assertEquals(6,after.data().edges().size()); assertEquals(4,after.revision());
    }
    @Test void archiveRetainsNodeAndConnections() {
        var r=edit(3,"[{\"op\":\"update_node\",\"id\":\"reduce\",\"fields\":{\"archived\":true}}]",admin);
        var after=(Snapshot)structured(r).get("board"); assertEquals(4,after.data().nodes().size());
        assertTrue(after.data().nodes().get(2).archived()); assertEquals(initial.data().edges(),after.data().edges());
    }
    @Test void invalidLaterOperationDoesNotPartiallySave() {
        var r=edit(3,"[{\"op\":\"update_node\",\"id\":\"reduce\",\"fields\":{\"title\":\"Changed\"}},{\"op\":\"remove_edge\",\"id\":\"missing\"}]",admin);
        assertEquals(true,r.get("isError")); noSave(); assertEquals("Reduce fractions",initial.data().nodes().get(2).title());
    }
    @Test void rejectsCyclesDuplicateParentsAndUnknownFields() {
        for(String json:List.of(
            "[{\"op\":\"add_edge\",\"source\":\"add\",\"target\":\"reduce\",\"kind\":\"prerequisite\"}]",
            "[{\"op\":\"add_edge\",\"source\":\"grade6\",\"target\":\"reduce\",\"kind\":\"contains\"}]",
            "[{\"op\":\"update_node\",\"id\":\"reduce\",\"fields\":{\"mastery\":100}}]",
            "[{\"op\":\"delete_node\",\"id\":\"reduce\"}]",
            "[{\"op\":\"update_node\",\"id\":\"grade6\",\"fields\":{\"archived\":true}}]",
            "[]", "not-json")) assertEquals(true,edit(3,json,admin).get("isError"),json);
        noSave();
    }
    @Test void reparentOnlyReplacesContainmentAndNoOpDoesNotWrite() {
        var r=edit(3,"[{\"op\":\"set_parent\",\"id\":\"add\",\"parentId\":\"grade6\"}]",admin);
        var after=(Snapshot)structured(r).get("board"); assertTrue(after.data().edges().stream().anyMatch(e->e.id().equals("s-a")));
        assertFalse(after.data().edges().stream().anyMatch(e->e.id().equals("t-a")));
        clearInvocations(boards);
        var same=edit(3,"[{\"op\":\"update_node\",\"id\":\"reduce\",\"fields\":{\"title\":\"Reduce fractions\"}}]",admin);
        assertEquals(true,structured(same).get("unchanged")); noSave();
    }
    @Test void transportPublishesAndCallsNewToolsWithRealJsonShapes() throws Exception {
        var oauth=mock(McpOAuthService.class); when(oauth.resolveAccessToken("skills-test-token")).thenReturn(Optional.of(admin));
        var constructor=MindcraftiMcpController.class.getConstructors()[0]; var args=new Object[constructor.getParameterCount()];
        args[0]=""; args[1]=mapper; args[3]=oauth;
        var controller=(MindcraftiMcpController)constructor.newInstance(args); controller.setSkillBoardMcpService(service);
        var listed=controller.post("Bearer skills-test-token",null,Map.of("id",1,"method","tools/list"));
        String listedJson=mapper.writeValueAsString(listed.getBody()); assertTrue(listedJson.contains("get_skill_board")); assertTrue(listedJson.contains("edit_skill_board")); assertTrue(listedJson.contains("get_month_plan"));
        String json="{\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"edit_skill_board\",\"arguments\":{\"expectedRevision\":3,\"operationsJson\":\"[{\\\"op\\\":\\\"update_node\\\",\\\"id\\\":\\\"reduce\\\",\\\"fields\\\":{\\\"title\\\":\\\"Renamed via MCP\\\"}}]\"}}}";
        @SuppressWarnings("unchecked") Map<String,Object> request=mapper.readValue(json,Map.class);
        var response=controller.post("Bearer skills-test-token",null,request);
        assertTrue(mapper.writeValueAsString(response.getBody()).contains("Renamed via MCP")); verify(boards).save(anyString(),any(),eq(admin.getId()));
        clearInvocations(boards);
        var denied=controller.post(null,null,request); assertTrue(mapper.writeValueAsString(denied.getBody()).contains("requires authentication")); noSave();
    }
}
