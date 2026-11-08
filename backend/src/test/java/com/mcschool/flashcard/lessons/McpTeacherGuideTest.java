package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.*;
import com.mcschool.flashcard.users.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.access.AccessDeniedException;
import tools.jackson.databind.ObjectMapper;

class McpTeacherGuideTest {
    private final ObjectMapper json=new ObjectMapper();
    private final McpAccessService access=mock(McpAccessService.class);
    private final User teacher=User.activeTeacher("Teacher","teacher@example.test","teacher","unused");
    private McpTeacherGuideService service()throws Exception{return new McpTeacherGuideService(access,json);}

    @Test void indexIsCompleteAndAllSourcesAndRelatedTopicsExist()throws Exception {
        var service=service();var result=service.read(teacher,false,Map.of());
        assertThat((List<?>)result.get("topics")).hasSizeGreaterThanOrEqualTo(20);
        assertThat(result).containsKeys("version","reviewedOn","verifiedRelease").doesNotContainKey("articles");
        verify(access).requireActor(teacher);
        try(var input=new ClassPathResource("mcp/teacher-guide.json").getInputStream()) {
            var guide=json.readValue(input,McpTeacherGuideService.Guide.class);
            for(var article:guide.articles()) {
                assertThat(article.body()).doesNotContain("\u2013","\u2014");
                for(String source:article.verifiedSources())assertThat(Path.of("..",source)).exists();
            }
        }
    }
    @Test void naturalQuestionsFindTheRelevantInstructionsWithBoundedResults()throws Exception {
        var service=service();
        var questions=Map.of("Как загрузить каждой ученице отдельное задание?","personal-materials",
            "Кто меня слышит когда открываю ученицу?","audio",
            "Как проверить сданную домашнюю работу?","homework",
            "Wie funktioniert Mikrofon Ton?","audio",
            "How to use personal worksheet?","personal-materials",
            "Почему панель ответов показывает старый документ?","answers",
            "ДЗ","homework");
        for(var entry:questions.entrySet()) {
            var response=service.read(teacher,false,Map.of("query",entry.getKey()));
            var articles=(List<McpTeacherGuideService.Article>)response.get("articles");
            assertThat(articles).hasSizeLessThanOrEqualTo(3);
            assertThat(articles).extracting(McpTeacherGuideService.Article::id).contains(entry.getValue());
        }
    }
    @Test void unknownQuestionsAndIdsReturnNoInventedAnswer()throws Exception {
        for(var args:List.of(Map.<String,Object>of("query","криптокошелек"),Map.<String,Object>of("topicId","../../secret"))) {
            var result=service().read(teacher,false,args);
            assertThat(result.get("found")).isEqualTo(false);assertThat((List<?>)result.get("articles")).isEmpty();
            assertThat(result).containsKey("topics");
        }
    }
    @Test void validatesInputsAndRechecksOAuthAccessOnEveryRead()throws Exception {
        var service=service();
        assertThatThrownBy(()->service.read(teacher,true,Map.of())).isInstanceOf(AccessDeniedException.class);
        for(var args:List.of(Map.<String,Object>of("query","a","topicId","audio"),Map.<String,Object>of("query","a".repeat(301)),
                Map.<String,Object>of("query",4),Map.<String,Object>of("teacherId","other")))
            assertThatThrownBy(()->service.read(teacher,false,args)).isInstanceOf(IllegalArgumentException.class);
        doThrow(new AccessDeniedException("Inactive account")).when(access).requireActor(teacher);
        assertThatThrownBy(()->service.read(teacher,false,Map.of())).isInstanceOf(AccessDeniedException.class);
    }
    @Test void fullArticleContainsOperationalLimitsRatherThanLiveStudentData()throws Exception {
        var result=service().read(teacher,false,Map.of("topicId","audio"));
        var article=((List<McpTeacherGuideService.Article>)result.get("articles")).get(0);
        assertThat(article.body()).contains("продолжает слышать всех","не отдельная приватная комната");
        assertThat(result).doesNotContainKeys("studentId","teacherId","eventId");
        assertThat(McpTeacherGuideService.definition().get("annotations")).isEqualTo(
            Map.of("readOnlyHint",true,"destructiveHint",false,"idempotentHint",true,"openWorldHint",false));
    }
}
