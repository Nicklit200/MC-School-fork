package com.mcschool.flashcard.skills;

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

class SchoolCalendarMcpServiceTest {
    SkillBoardService boardService;
    SchoolCalendarService calendarService;
    SchoolCalendarMcpService mcp;
    Snapshot existing;
    UUID adminId;
    User admin, teacher;
    JsonMapper mapper;

    @BeforeEach
    void setup() {
        mapper = JsonMapper.builder().build();
        boardService = mock(SkillBoardService.class);
        calendarService = new SchoolCalendarService(boardService, mapper);
        mcp = new SchoolCalendarMcpService(calendarService, boardService, mapper);
        adminId = UUID.randomUUID();
        admin = user(Role.ADMIN, adminId);
        teacher = user(Role.TEACHER, UUID.randomUUID());
        Board data = new Board(1, "6. Klasse Mathematik", 6, "LehrplanPLUS Bayern",
            List.of(
                new Node("grade6","root","Grade 6","","","","","orange",0,0,false),
                new Node("topic-4","topic","Ganze Zahlen","","","","","teal",200,0,false),
                new Node("skill-4-1","skill","Negative numbers","","","","","teal",400,0,false)),
            List.of(new Edge("root-topic","grade6","topic-4","contains"),
                    new Edge("topic-skill","topic-4","skill-4-1","contains")));
        existing = new Snapshot("grade-6", 4, Instant.now(), data);
        when(boardService.get("grade-6")).thenReturn(existing);
        when(boardService.list()).thenReturn(List.of(new BoardSummary("grade-6", "Math 6", 6, 4, Instant.now())));
        when(boardService.save(eq("grade-6"),any(SaveRequest.class),eq(adminId))).thenAnswer(inv -> {
            SaveRequest next=inv.getArgument(1);
            return new Snapshot("grade-6",5,Instant.now(),next.data());
        });
    }

    User user(Role role,UUID id) {
        User user=mock(User.class);
        when(user.getRole()).thenReturn(role);
        when(user.getId()).thenReturn(id);
        return user;
    }

    String validCalendar() {
        return """
          {"version":1,"schoolType":"WIRTSCHAFTSSCHULE","grade":6,"profile":"vierstufig",
           "status":"EXAMPLE_NOT_SCHOOL_CONFIRMED","sourceLabel":"Example 2019/20",
           "sourceUrl":"https://example.org/plan.pdf","officialSourceUrl":"https://www.lehrplanplus.bayern.de/",
           "disclaimer":"Illustrative only, not this pupil's actual school pace or exam dates",
           "months":[{"month":11,"weeks":"KW45-48","note":"Negative numbers",
           "topics":[{"name":"Ganze Zahlen","boardTopicId":"topic-4"}]}]}
          """;
    }

    Map<String,Object> args(long revision, String json) {
        return Map.of("schoolType","WIRTSCHAFTSSCHULE",
            "expectedRevision",revision,"calendarJson",json);
    }

    @SuppressWarnings("unchecked")
    Map<String,Object> value(Map<String,Object> raw) {
        return (Map<String,Object>)raw.get("structuredContent");
    }

    @Test
    void teacherCanReadButOnlyAdminMayWrite() {
        var read = mcp.call("get_school_calendar",Map.of("schoolType","WIRTSCHAFTSSCHULE"),teacher);
        assertEquals(false,read.get("isError"));
        assertEquals(false,value(read).get("available"));
        assertEquals("NOT_CONFIGURED",value(read).get("status"));
        var denied = mcp.call("upsert_school_calendar",args(4,validCalendar()),teacher);
        assertEquals(true,denied.get("isError"));
        assertEquals("FORBIDDEN",value(denied).get("errorCode"));
        verify(boardService,never()).save(anyString(),any(),any());
    }

    @Test
    void adminAddsCalendarPreservingAllExistingNodesAndEdges() throws Exception {
        var r=mcp.call("upsert_school_calendar",args(4,validCalendar()),admin);
        assertEquals(false,r.get("isError"));
        assertEquals(true,value(r).get("saved"));
        var captured=ArgumentCaptor.forClass(SaveRequest.class);
        verify(boardService).save(eq("grade-6"),captured.capture(),eq(adminId));
        SaveRequest save=captured.getValue();
        assertEquals(4,save.expectedRevision());
        assertEquals(existing.data().edges(),save.data().edges());
        assertEquals(existing.data().nodes(),save.data().nodes().subList(0,3));
        assertEquals(4,save.data().nodes().size());
        assertEquals("school_calendar_wirtschaftsschule_6_vierstufig",save.data().nodes().get(3).id());
        assertEquals("note",save.data().nodes().get(3).kind());
        SkillBoardService.validate(save.data());
        when(boardService.get("grade-6")).thenReturn(new Snapshot("grade-6",5,Instant.now(),save.data()));
        var read=calendarService.get("grade-6","WIRTSCHAFTSSCHULE",null,11);
        assertEquals(true,read.get("available"));
        assertEquals(true,read.get("calendarIsIllustrative"));
        assertEquals(11,read.get("requestedMonth"));
        assertEquals("KW45-48",((Map<?,?>)read.get("monthPlan")).get("weeks"));
    }

    @Test
    void staleRevisionNeverWrites() {
        var r=mcp.call("upsert_school_calendar",args(3,validCalendar()),admin);
        assertEquals(true,r.get("isError"));
        assertEquals("REVISION_CONFLICT",value(r).get("errorCode"));
        verify(boardService,never()).save(anyString(),any(),any());
    }

    @Test
    void unlinkedOrInventedTopicsAreBlocked() {
        String invalid=validCalendar().replace("topic-4","not-a-real-topic");
        var r=mcp.call("upsert_school_calendar",args(4,invalid),admin);
        assertEquals(true,r.get("isError"));
        assertEquals("INVALID_SCHOOL_CALENDAR",value(r).get("errorCode"));
        verify(boardService,never()).save(anyString(),any(),any());
    }

    @Test
    void invalidSourceCannotBeCalledSchoolConfirmed() {
        String invalid=validCalendar()
            .replace("EXAMPLE_NOT_SCHOOL_CONFIRMED","SCHOOL_CONFIRMED")
            .replace("Example 2019/20","");
        var r=mcp.call("upsert_school_calendar",args(4,invalid),admin);
        assertEquals(true,r.get("isError"));
        verify(boardService,never()).save(anyString(),any(),any());
    }
}
