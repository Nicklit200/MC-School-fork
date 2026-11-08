package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import com.mcschool.flashcard.common.ConflictException;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class MathSceneSpecTest {
    private static final ObjectMapper JSON=new ObjectMapper();
    @SuppressWarnings("unchecked") private List<Map<String,Object>> examples()throws Exception{
        return JSON.readValue(Files.readString(Path.of("../frontend/e2e/math-scenes.json")),List.class);
    }
    @Test void validatesTheSameGeometryFunctionAndDataFixturesAsTheBrowser()throws Exception{
        for(var scene:examples())assertThatCode(()->InteractiveTemplateSpec.validate(scene)).doesNotThrowAnyException();
    }
    @Test void onlyParameterValuesCanChangeDuringInteraction()throws Exception{
        var scene=examples().get(0);var changed=examples().get(0);
        ((Map<String,Object>)((List<?>)changed.get("parameters")).get(0)).put("value",6);
        assertThatCode(()->InteractiveTemplateSpec.sameTemplate(scene,changed)).doesNotThrowAnyException();
        changed.put("answer","0");
        assertThatThrownBy(()->InteractiveTemplateSpec.sameTemplate(scene,changed)).isInstanceOf(ConflictException.class);
    }
    @Test void numericRepresentationDoesNotChangeTheConstruction()throws Exception{
        var scene=examples().get(0);var changed=examples().get(0);
        ((Map<String,Object>)changed.get("bounds")).put("xMin",-1.0);
        assertThatCode(()->InteractiveTemplateSpec.sameTemplate(scene,changed)).doesNotThrowAnyException();
    }
    @Test void rejectsUnknownSymbolsCodeAndExcessiveDepth(){
        for(var expression:List.of("a+1","-2^2","2^3^2","sqrt(a^2+16)","sin(pi/2)","ln(exp(1))"))
            assertThatCode(()->MathSceneSpec.expression(expression,Set.of("a"))).doesNotThrowAnyException();
        for(var expression:List.of("x","a=3","Math.sin(1)","constructor","sin(1,2)","2a","1;2","1e999","(".repeat(30)+"1"+")".repeat(30)))
            assertThatThrownBy(()->MathSceneSpec.expression(expression,Set.of("a"))).isInstanceOf(ConflictException.class);
    }
    @Test void rejectsBrokenReferencesAndOutOfBoundsState()throws Exception{
        var scene=examples().get(0);scene.put("objects",List.of(Map.of("kind","segment","a","A","b","UNKNOWN")));
        assertThatThrownBy(()->MathSceneSpec.validate(scene)).isInstanceOf(ConflictException.class);
        var other=examples().get(0);((Map<String,Object>)((List<?>)other.get("parameters")).get(0)).put("value",999);
        assertThatThrownBy(()->MathSceneSpec.validate(other)).isInstanceOf(ConflictException.class);
        var leaked=examples().get(2);leaked.put("metrics",List.of(Map.of("label","Ответ","expression"," (a+b+c) / 3 ")));
        assertThatThrownBy(()->MathSceneSpec.validate(leaked)).isInstanceOf(ConflictException.class);
    }
}
