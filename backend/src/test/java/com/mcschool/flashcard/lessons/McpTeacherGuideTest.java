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
    private final TeacherHelpCenterService helpCenter=mock(TeacherHelpCenterService.class);
    private McpTeacherGuideService service()throws Exception{
        when(helpCenter.published()).thenReturn(Map.of());
        when(helpCenter.customImages()).thenReturn(List.of());
        when(helpCenter.image(anyString())).thenReturn(Optional.empty());
        return new McpTeacherGuideService(access,json,helpCenter);
    }

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
    @Test void onboardingAndButtonQuestionsFindRelevantHelp()throws Exception {
        var questions=Map.ofEntries(
            Map.entry("Я новый преподаватель, как вообще проводить урок?","lesson-flow"),
            Map.entry("Что подготовить и включить перед уроком?","lesson-ready"),
            Map.entry("Где находится вкладка решения?","answers"),
            Map.entry("Покажи на фото где кнопки","interface-map"),
            Map.entry("Как работает переключение звука?","audio"),
            Map.entry("Кому слышно когда открываю ученика?","audio"),
            Map.entry("Как сказать всем и вернуться к ученику?","audio"),
            Map.entry("Почему у ученика нет общих решений?","answers"),
            Map.entry("Как дать разный PDF каждому?","personal-materials"),
            Map.entry("Где включить расшифровку?","transcript"),
            Map.entry("Wo finde ich Lösungen?","answers"),
            Map.entry("How do I prepare my first lesson?","lesson-flow"));
        var service=service();
        for(var entry:questions.entrySet()) {
            var matches=(List<McpTeacherGuideService.Article>)service.read(teacher,false,Map.of("query",entry.getKey())).get("articles");
            assertThat(matches).as(entry.getKey()).extracting(McpTeacherGuideService.Article::id).contains(entry.getValue());
        }
    }
    @Test void workbookPreparationStartsInChatGptAndSeparatesDraftFromAttachment()throws Exception {
        var service=service();
        for(String query:List.of("Как создать рабочие тетради в ChatGPT через коннектор?","Сделать тетрадь по школьному промпту","Arbeitsheft erstellen")) {
            var articles=(List<McpTeacherGuideService.Article>)service.read(teacher,false,Map.of("query",query)).get("articles");
            assertThat(articles).as(query).extracting(McpTeacherGuideService.Article::id).contains("generator");
        }
        var article=((List<McpTeacherGuideService.Article>)service.read(teacher,false,Map.of("topicId","generator")).get("articles")).get(0);
        assertThat(article.body()).contains("ChatGPT с подключённым MCH3","отдельный PDF с решениями","Сначала покажи готовые файлы","Прикрепи эти тетради", "команда на оба действия");
    }
    @Test void screenshotsAreOptInDecodableAndNeverDuplicatedInsideText()throws Exception {
        var service=service();
        for(var args:List.of(Map.<String,Object>of(),Map.<String,Object>of("query","Где решения?"),Map.<String,Object>of("topicId","answers"))) {
            var result=service.call(teacher,false,args);
            var content=(List<Map<String,Object>>)result.get("content");
            assertThat(content).hasSize(1);
            assertThat(content.get(0).get("type")).isEqualTo("text");
            assertThat(content.get(0).get("text").toString()).doesNotContain("iVBOR","base64");
        }
        var topic=service.read(teacher,false,Map.of("topicId","answers"));
        assertThat((List<McpTeacherGuideService.GuideImage>)topic.get("images"))
            .extracting(McpTeacherGuideService.GuideImage::id).contains("answers-panel","upload-solutions");
        try(var input=new ClassPathResource("mcp/teacher-guide.json").getInputStream()) {
            for(var image:json.readValue(input,McpTeacherGuideService.Guide.class).images()) {
                var result=service.call(teacher,false,Map.of("imageId",image.id()));
                var content=(List<Map<String,Object>>)result.get("content");
                assertThat(content).hasSize(2);
                assertThat(content.get(1)).containsEntry("type","image").containsEntry("mimeType","image/jpeg");
                var bytes=Base64.getDecoder().decode(content.get(1).get("data").toString());
                assertThat(bytes.length).isBetween(8,500_000);
                assertThat(bytes).startsWith((byte)0xff,(byte)0xd8,(byte)0xff);
                var decoded=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(bytes));
                assertThat(decoded).isNotNull();
                assertThat(decoded.getWidth()).isGreaterThanOrEqualTo(600);
                assertThat(json.writeValueAsString(result.get("structuredContent"))).doesNotContain("iVBOR","base64","studentId");
                assertThat(content.get(0).get("text").toString()).contains(image.description());
                assertThat(image.controls()).isNotEmpty();
            }
        }
    }
    @Test void classroomStepsHaveSpecificControlIllustrations()throws Exception {
        var service=service();
        for(var entry:Map.of("answers",List.of("Ответы","Загрузить PDF решений"),
                "boards",List.of("Общая группа","Имя ученика","Все"),
                "audio",List.of("Сказать всем","Вернуться к ученику"),
                "saving",List.of("Выйти","Завершить урок для всех","Все документы")).entrySet()) {
            var images=(List<McpTeacherGuideService.GuideImage>)service.read(teacher,false,Map.of("topicId",entry.getKey())).get("images");
            assertThat(images.stream().flatMap(i->i.controls().stream()).toList()).containsAll(entry.getValue());
        }
    }
    @Test void screenshotReadsUseTheSameAccessAndArgumentBoundaries()throws Exception {
        var service=service();
        assertThatThrownBy(()->service.call(teacher,true,Map.of("imageId","answers-panel"))).isInstanceOf(AccessDeniedException.class);
        for(var args:List.of(Map.<String,Object>of("query","answers","imageId","answers-panel"),
                Map.<String,Object>of("topicId","answers","imageId","answers-panel"),Map.<String,Object>of("imageId",1),
                Map.<String,Object>of("imageId","x".repeat(81))))
            assertThatThrownBy(()->service.call(teacher,false,args)).isInstanceOf(IllegalArgumentException.class);
        for(String id:List.of("../teacher-guide.json","unknown","https://example.test/private.png")) {
            var result=service.call(teacher,false,Map.of("imageId",id));
            assertThat(((Map<?,?>)result.get("structuredContent")).get("found")).isEqualTo(false);
            assertThat((List<?>)result.get("content")).hasSize(1);
        }
        doThrow(new AccessDeniedException("Inactive account")).when(access).requireActor(teacher);
        assertThatThrownBy(()->service.call(teacher,false,Map.of("imageId","answers-panel"))).isInstanceOf(AccessDeniedException.class);
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
    @Test void visibleGalleryKeepsOrderedJpegsOutOfModelContent()throws Exception {
        var result=service().show(teacher,false,Map.of("imageIds",List.of("all-boards","answers-panel")));
        var value=(Map<String,Object>)result.get("structuredContent");
        assertThat(value).containsEntry("presentationState","prepared");
        assertThat((List<McpTeacherGuideService.GuideImage>)value.get("images"))
            .extracting(McpTeacherGuideService.GuideImage::id).containsExactly("all-boards","answers-panel");
        assertThat(json.writeValueAsString(value)).doesNotContain("base64","data:image");
        assertThat(json.writeValueAsString(result.get("content"))).doesNotContain("base64","data:image");
        var assets=(Map<String,String>)((Map<?,?>)result.get("_meta")).get("mindcrafti/teacherGuideImages");
        assertThat(assets).containsOnlyKeys("all-boards","answers-panel");
        for(var source:assets.values()) {
            assertThat(source).startsWith("data:image/jpeg;base64,");
            assertThat(Base64.getDecoder().decode(source.substring(source.indexOf(',')+1))).startsWith((byte)0xff,(byte)0xd8,(byte)0xff);
        }
        assertThat(value.get("presentation").toString()).contains("does not prove","show_teacher_guide");
        verify(access).requireActor(teacher);
    }
    @Test void galleryRejectsPathsDuplicatesOversizedSelectionsAndInactiveAccounts()throws Exception {
        var service=service();
        for(var args:List.of(Map.<String,Object>of(),Map.<String,Object>of("imageIds",List.of()),
                Map.<String,Object>of("imageIds",List.of("answers-panel","answers-panel")),
                Map.<String,Object>of("imageIds",List.of("../teacher-guide.json")),
                Map.<String,Object>of("imageIds",List.of(3)),
                Map.<String,Object>of("imageIds",List.of("a","b","c","d","e","f","g")),
                Map.<String,Object>of("imageIds",List.of("answers-panel"),"url","https://example.test")))
            assertThatThrownBy(()->service.show(teacher,false,args)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->service.show(teacher,true,Map.of("imageIds",List.of("answers-panel")))).isInstanceOf(AccessDeniedException.class);
        doThrow(new AccessDeniedException("Inactive")).when(access).requireActor(teacher);
        assertThatThrownBy(()->service.show(teacher,false,Map.of("imageIds",List.of("answers-panel")))).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(()->service.resource(teacher,false)).isInstanceOf(AccessDeniedException.class);
    }
    @Test void galleryUsesRegisteredUiResourceAndTextReadsNeverClaimDisplay()throws Exception {
        var definition=McpTeacherGuideService.showDefinition();
        assertThat(((Map<?,?>)definition.get("_meta")).containsKey("ui")).isTrue();
        assertThat(((Map<?,?>)definition.get("_meta")).get("openai/outputTemplate")).isEqualTo(McpTeacherGuideService.UI_RESOURCE);
        assertThat(McpTeacherGuideService.definition()).doesNotContainKey("_meta");
        var resource=service().resource(teacher,false);
        var item=(Map<String,Object>)((List<?>)resource.get("contents")).get(0);
        assertThat(item).containsEntry("uri",McpTeacherGuideService.UI_RESOURCE).containsEntry("mimeType",McpTeacherGuideService.UI_MIME);
        assertThat(item.get("text").toString()).contains("ui/notifications/tool-result","<dialog","Кнопки Mindcrafti").doesNotContain("<script src=","fetch(");
        assertThat(service().read(teacher,false,Map.of("topicId","audio")).get("presentation").toString()).contains("Never say");
    }
}
