package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import com.mcschool.flashcard.common.ConflictException;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class InteractiveTemplateSpecTest {
    @Test void validatesCubeAndInfersSpokenInteractiveRequests() {
        var cube=new HashMap<String,Object>(Map.of("template","cube","language","ru","unfold",0.5,"yaw",-30,"pitch",25));
        assertThat(InteractiveTemplateSpec.validate(cube)).isEqualTo(cube);
        cube.put("unfold",1.01);assertThatThrownBy(()->InteractiveTemplateSpec.validate(cube)).isInstanceOf(ConflictException.class);
        assertThat(KolinTaskService.interactiveRequest("Раскрой куб для Виталины",null,null)).isTrue();
        assertThat(KolinTaskService.interactiveRequest("Сделай PDF развёртки куба",null,null)).isFalse();
        assertThat(KolinTaskService.interactiveRequest("Это на общую доску",null,
                new KolinTaskService.Content("interactive","","group",List.of()))).isTrue();
    }
    static Map<String,Object> graph() { return Map.of("template","graph","language","ru","function","quadratic","coefficients",List.of(1,-4,3)); }
    @Test void acceptsAllThreeClosedNumericTemplates() {
        for(var spec:List.of(graph(),Map.of("template","triangle","language","de","vertices",List.of(List.of(0,0),List.of(3,0),List.of(0,4))),
                Map.of("template","fractionCircle","language","ru","parts",12,"selected",List.of(0,1,2,3,4,5))))
            assertThat(InteractiveTemplateSpec.validate(spec)).isEqualTo(spec);
    }
    @Test void rejectsUnsafeMalformedOrDegenerateData() {
        var extra=new HashMap<>(graph());extra.put("html","<script>alert(1)</script>");
        for(var spec:List.of(extra,Map.of("template","triangle","language","ru","vertices",List.of(List.of(0,0),List.of(1,1),List.of(2,2))),
            Map.of("template","fractionCircle","language","ru","parts",12,"selected",List.of(1,1)),
            Map.of("template","fractionCircle","language","ru","parts",12,"selected",List.of(12)),
            Map.of("template","graph","language","ru","function","linear","coefficients",List.of(Double.NaN,0)),
            Map.of("template","graph","function","linear","coefficients",List.of(1,0))))
            assertThatThrownBy(()->InteractiveTemplateSpec.validate(spec)).isInstanceOf(ConflictException.class);
    }
    @Test void annotationUpdatesRequireARevisionAndCannotChangeTheFrame() {
        var mapper=JsonMapper.builder().build();var validator=new AnnotationPayloadValidator(mapper);
        var shape=new HashMap<>(InteractiveTemplateSpec.shape(graph()));
        assertThat(validator.validate(AnnotationOperationType.ADD,mapper.writeValueAsString(shape))).contains("interactive");
        shape.put("targetOperationId",UUID.randomUUID().toString());
        assertThatThrownBy(()->validator.validate(AnnotationOperationType.UPDATE,mapper.writeValueAsString(shape))).isInstanceOf(ConflictException.class);
        shape.put("baseOperationId",UUID.randomUUID().toString());
        assertThatCode(()->validator.validate(AnnotationOperationType.UPDATE,mapper.writeValueAsString(shape))).doesNotThrowAnyException();
        shape.put("w",1.0);
        assertThatThrownBy(()->validator.validate(AnnotationOperationType.UPDATE,mapper.writeValueAsString(shape))).isInstanceOf(ConflictException.class);
    }
}
