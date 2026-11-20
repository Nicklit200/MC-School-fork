package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import com.mcschool.flashcard.lessons.KolinVisualSchema;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class KolinVisualTaskTest {
    private final JsonMapper mapper=JsonMapper.builder().build();
    private static KolinTaskService.Task visual(Map<String,Object> spec) {
        return new KolinTaskService.Task("visual","","","MODEL ANSWER MUST BE IGNORED","",List.of(),spec);
    }
    private static Map<String,Object> graph(String objective) {
        return Map.of("type","graph","language","ru","objective",objective,"at",2,"xRange",List.of(-5,5),"yRange",List.of(-5,10),
                "series",List.of(Map.of("kind","quadratic","parameters",List.of(1,0,-4),"denominator",List.of())));
    }
    @Test void graphInequalityProviderContractRequiresAnExplicitComparisonLevel() {
        var variants=(List<?>)KolinVisualSchema.schema().get("anyOf");
        var comparisons=variants.stream().filter(variant->variant instanceof Map<?,?> shape
                && shape.get("properties") instanceof Map<?,?> props && props.containsKey("level")).toList();
        assertThat(comparisons).hasSize(1);
        Map<?,?> contract=(Map<?,?>)comparisons.get(0);
        Map<?,?> properties=(Map<?,?>)contract.get("properties");
        assertThat(((Map<?,?>)properties.get("objective")).get("enum")).isEqualTo(List.of("aboveBelow"));
        assertThat(((List<?>)contract.get("required")).stream().map(String::valueOf).toList())
                .contains("level","xRange","yRange","series");
        assertThat(KolinVisualSchema.INSTRUCTIONS).contains("aboveBelow","f(x)>level","level=0");
    }
    @Test void figuresStayPrivateAndEachTaskIsBoundToOneComputedReference() throws Exception {
        var tasks=List.of(visual(graph("zeros")),
                visual(Map.of("type","geometry","language","ru","figure","triangle","objective","area","vertices",List.of(List.of(0,0),List.of(6,0),List.of(0,8)),"parameters",List.of(),"index",0)),
                visual(Map.of("type","geometry","language","ru","figure","cylinder","objective","volume","vertices",List.of(),"parameters",List.of(3,4),"index",0)),
                visual(Map.of("type","fractionCircle","language","ru","parts",12,"selected",6)),visual(graph("draw")));
        var doc=KolinTaskService.document(tasks);
        var tree=mapper.readTree(mapper.writeValueAsString(doc));
        assertThat(tree.path("workbookPages").size()).isEqualTo(3);
        assertThat(tree.path("qa").path("algebra").size()).isEqualTo(5);
        assertThat(tree.toString()).doesNotContain("MODEL ANSWER","http","<svg");
        for(int i=0;i<5;i++)assertThat(tree.path("qa").path("algebra").get(i).path("number").asInt()).isEqualTo(i+1);
        var verified=KolinTaskService.withVerifiedAnswers(new KolinTaskService.Content("worksheet","Test","synthetic",tasks),
                Map.of("results",Collections.nCopies(5,Map.of("passed",true,"answer","VERIFIED"))));
        assertThat(verified.tasks().get(0).visual()).isEqualTo(tasks.get(0).visual());
        assertThat(verified.tasks().get(0).answer()).isEqualTo("VERIFIED");
        String dir=System.getProperty("kolin.visualFixtureDir");
        if(dir!=null){Files.createDirectories(Path.of(dir));Files.writeString(Path.of(dir,"visual-demo.json"),mapper.writerWithDefaultPrettyPrinter().writeValueAsString(doc));}
    }
    @Test void modelProseCannotOverrideCanonicalConditionsOrPolluteFollowupContext() throws Exception {
        var task=new KolinTaskService.Task("visual","Wrong extra claim 999","x=999","UNVERIFIED","x",List.of("x != 0"),graph("zeros"));
        assertThat(mapper.writeValueAsString(KolinTaskService.document(List.of(task)))).doesNotContain("999","UNVERIFIED","x != 0");
        var verified=KolinTaskService.withVerifiedAnswers(new KolinTaskService.Content("worksheet","Test","synthetic",List.of(task)),
                Map.of("results",List.of(Map.of("passed",true,"answer","CHECKED")))).tasks().get(0);
        assertThat(verified.instruction()).isEmpty();assertThat(verified.expression()).isEmpty();assertThat(verified.restrictions()).isEmpty();
        assertThat(verified.answer()).isEqualTo("CHECKED");
        assertThatThrownBy(()->KolinTaskService.document(List.of(new KolinTaskService.Task("expression","Compute","1+1","","",List.of(),graph("zeros")))))
                .isInstanceOf(IllegalArgumentException.class);
    }
    @Test void optionalLiveModelSamplesUseTheRealDocumentAdapter() throws Exception {
        String dir=System.getProperty("kolin.visualFixtureDir");if(dir==null)return;
        for(String name:List.of("graphs","geometry","fractions")) {
            Path sample=Path.of(dir,"provider-"+name+".json");if(!Files.exists(sample))continue;
            var content=mapper.treeToValue(mapper.readTree(Files.readString(sample)).path("content"),KolinTaskService.Content.class);
            assertThat(content.tasks()).hasSize(5);
            var document=KolinTaskService.document(content.tasks());
            Files.writeString(Path.of(dir,"document-"+name+".json"),mapper.writerWithDefaultPrettyPrinter().writeValueAsString(document));
        }
    }
    @Test void mixedMathAndPicturesKeepNumbersAndTheSameAlgebraGuards() throws Exception {
        var doc=KolinTaskService.document(List.of(visual(graph("zeros")),new KolinTaskService.Task("expression","Вычисли","1+1","","",List.of())));
        var tree=mapper.readTree(mapper.writeValueAsString(doc));
        assertThat(tree.path("workbookPages").size()).isEqualTo(1);
        assertThat(tree.path("qa").path("algebra").get(1).path("expression").asString()).isEqualTo("1+1");
        assertThat(tree.toString()).contains("2.");
        assertThatThrownBy(()->KolinTaskService.document(List.of(visual(graph("zeros")),new KolinTaskService.Task("expression","Вычисли 99","1+1","","",List.of()))))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
