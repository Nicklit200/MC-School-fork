package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class McpHomeworkDraftValidatorTest {
    private final ObjectMapper mapper=new ObjectMapper();

    private String document(int day,int tasks,int minutes,boolean hint) {
        List<Map<String,Object>> blocks=new ArrayList<>();
        if(hint)blocks.add(Map.of("type","callout","label","Merke","text","Умножай верх и низ на одно число (Zähler, Nenner)."));
        for(int n=1;n<=tasks;n++)blocks.add(Map.of("type","exercise","number",n,"title","Berechne.",
                "rows",List.of(Map.of("label","", "math",Map.of("latex",n+"+2"),"work",true)),
                "writeLines",6));
        List<Map<String,Object>> qa=new ArrayList<>();
        for(int n=1;n<=tasks;n++)qa.add(Map.of("kind","equivalence","number",n,
                "expression",n+"+2","answer",n+2,"restrictions",List.of()));
        return mapper.writeValueAsString(Map.of(
                "meta",Map.of("school","MINDCRAFTI SCHOOL","subject","MATHEMATIK",
                        "durationMinutes",60,"homeworkEstimatedMinutes",minutes),
                "workbookPages",List.of(Map.of("title","Hausaufgaben","subtitle","Berechne.",
                        "blocks",blocks)),
                "teacherPages",List.of(Map.of("title","Lösungen",
                        "blocks",List.of(Map.of("type","solutions","items",List.of(
                                Map.of("label","1","math",Map.of("latex","1+2=3"))))))),
                "qa",Map.of("algebra",qa)));
    }

    @Test void validatesFirstFourDaysAndAddsPrivateDisplayMetadata()throws Exception {
        for(int day=1;day<=4;day++){
            var raw=McpHomeworkDraftValidator.normalize(mapper,document(day,2,8,true),day,"Sofia");
            Map<?,?> parsed=mapper.readValue(raw,Map.class);
            Map<?,?> meta=(Map<?,?>)parsed.get("meta");
            assertEquals(Boolean.TRUE,meta.get("homeworkMode"));
            assertEquals(day,meta.get("homeworkDay"));
            assertEquals(8,meta.get("homeworkEstimatedMinutes"));
            assertEquals(1,((List<?>)parsed.get("workbookPages")).size());
        }
    }

    @Test void validatesLastThreeDaysWithoutRussianHelp()throws Exception {
        for(int day=5;day<=7;day++){
            final int currentDay=day;
            assertDoesNotThrow(()->McpHomeworkDraftValidator.normalize(mapper,document(currentDay,1,5,false),currentDay,"Sofia"));
            assertThrows(IllegalArgumentException.class,
                    ()->McpHomeworkDraftValidator.normalize(mapper,document(currentDay,1,5,true),currentDay,"Sofia"));
        }
    }

    @Test void stopsOverloadedOrUnderexplainedDays()throws Exception {
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,document(1,3,8,true),1,"Sofia"));
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,document(1,2,11,true),1,"Sofia"));
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,document(1,2,8,false),1,"Sofia"));
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,document(1,2,8,true),8,"Sofia"));
    }

    @Test void rejectsLeakageOfNameAndDayNumbersOnPupilPages()throws Exception {
        Map<String,Object> doc=mapper.readValue(document(5,1,6,false),Map.class);
        ((Map<String,Object>)((List<?>)doc.get("workbookPages")).get(0)).put("title","Sofia · Tag 05");
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,mapper.writeValueAsString(doc),5,"Sofia"));
    }

    @Test void requiresSixLinesAndMatchingQaAssertions()throws Exception {
        Map<String,Object> doc=mapper.readValue(document(1,2,8,true),Map.class);
        var p=(Map<String,Object>)((List<?>)doc.get("workbookPages")).get(0);
        var blocks=(List<Map<String,Object>>)p.get("blocks");
        blocks.get(1).put("writeLines",4);
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,mapper.writeValueAsString(doc),1,"Sofia"));
        blocks.get(1).put("writeLines",6);
        ((List<Map<String,Object>>)((Map<String,Object>)doc.get("qa")).get("algebra")).get(1).put("number",1);
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.normalize(mapper,mapper.writeValueAsString(doc),1,"Sofia"));
    }

    @Test void seriesKeyBindsSevenDaysAndRejectsAmbiguousReferences(){
        assertNotEquals(McpHomeworkDraftValidator.seriesMarker("approved-homework-7",1),
                McpHomeworkDraftValidator.seriesMarker("approved-homework-7",2));
        assertNotEquals(McpHomeworkDraftValidator.seriesMarker("approved-homework-7",1),
                McpHomeworkDraftValidator.seriesMarker("another-homework-7",1));
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.seriesMarker("bad",1));
        assertThrows(IllegalArgumentException.class,()->McpHomeworkDraftValidator.seriesMarker("approved-homework-7",8));
    }
}
