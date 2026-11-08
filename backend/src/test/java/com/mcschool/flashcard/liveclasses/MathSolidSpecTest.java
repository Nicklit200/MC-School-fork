package com.mcschool.flashcard.liveclasses;
import static org.assertj.core.api.Assertions.*;
import java.util.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import com.mcschool.flashcard.common.ConflictException;
class MathSolidSpecTest {
    @SuppressWarnings("unchecked") private List<Map<String,Object>> fixtures()throws Exception{return new ObjectMapper().readValue(Files.readString(Path.of("../frontend/e2e/math-solids.json")),List.class);}
    @Test void acceptsTheSameFourMeshesAsTheBrowser()throws Exception{for(var s:fixtures())assertThatCode(()->InteractiveTemplateSpec.validate(s)).doesNotThrowAnyException();}
    @Test @SuppressWarnings("unchecked") void allowsOnlyParameterValuesAndCameraUpdates()throws Exception{
        var before=fixtures().get(0);var after=fixtures().get(0);after.put("yaw",45);after.put("pitch",15);
        ((Map<String,Object>)((List<?>)after.get("parameters")).get(1)).put("value",6);
        InteractiveTemplateSpec.validate(after);assertThatCode(()->InteractiveTemplateSpec.sameTemplate(before,after)).doesNotThrowAnyException();
        after.put("title","Pupil changed task");assertThatThrownBy(()->InteractiveTemplateSpec.sameTemplate(before,after)).isInstanceOf(ConflictException.class);
    }
    @Test @SuppressWarnings("unchecked") void rejectsOpenNonplanarSelfIntersectingAndUnboundedData()throws Exception{
        var open=fixtures().get(0);((List<?>)open.get("faces")).remove(0);
        var crossed=fixtures().get(0);((List<Object>)crossed.get("faces")).set(0,List.of("A","C","B","D"));
        var bent=fixtures().get(0);((Map<String,Object>)((List<?>)bent.get("vertices")).get(0)).put("z","0.5");
        var code=fixtures().get(0);((Map<String,Object>)((List<?>)code.get("vertices")).get(0)).put("x","window.location");
        var large=fixtures().get(0);((Map<String,Object>)((List<?>)large.get("parameters")).get(0)).put("value",999);
        var leak=fixtures().get(0);leak.put("answer","volume");
        for(var s:List.of(open,crossed,bent,code,large,leak))assertThatThrownBy(()->InteractiveTemplateSpec.validate(s)).isInstanceOf(ConflictException.class);
    }
    @Test void expressionEvaluationMatchesMathematicalPrecedence(){
        assertThat(MathSceneSpec.evaluate("-2^2",Map.of())).isEqualTo(-4);
        assertThat(MathSceneSpec.evaluate("2^3^2",Map.of())).isEqualTo(512);
        assertThat(MathSceneSpec.evaluate("a*a*h/3",Map.of("a",4d,"h",3d))).isEqualTo(16);
        assertThat(MathSceneSpec.evaluate("sin(pi/2)+sqrt(4)",Map.of())).isCloseTo(3,within(1e-12));
    }
    @Test @org.junit.jupiter.api.condition.EnabledIfSystemProperty(named="kolin.generatedFixtureDir",matches=".+")
    @SuppressWarnings("unchecked") void validatesCapturedProviderDraftsWithTheProductionContract()throws Exception{
        int checked=0;
        try(var files=Files.list(Path.of(System.getProperty("kolin.generatedFixtureDir")))){
            for(var file:files.filter(p->p.toString().endsWith(".json")).toList()){
                var saved=new ObjectMapper().readTree(Files.readString(file));var content=saved.path("content");
                if("unsupported".equals(saved.path("name").asString())&&"interactive".equals(content.path("kind").asString())){
                    var draft=new ObjectMapper().convertValue(content,KolinTaskService.Content.class);
                    assertThat(KolinTaskService.unsupportedInteractive(saved.path("question").asString(),draft.tasks())).isTrue();continue;
                }
                assertThat(saved.path("valid").asBoolean()).as(file.getFileName().toString()).isTrue();
                if(!"interactive".equals(content.path("kind").asString()))continue;
                for(var task:content.path("tasks")){
                    var spec=new ObjectMapper().convertValue(task.path("visual"),Map.class);
                    assertThatCode(()->InteractiveTemplateSpec.validate(spec)).as(file.getFileName().toString()).doesNotThrowAnyException();checked++;
                }
            }
        }assertThat(checked).isGreaterThanOrEqualTo(6);
    }
}
