package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.*;
import com.mcschool.flashcard.lessons.AiLessonPilotService;
import com.mcschool.flashcard.users.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

class KolinChatServiceTest {
    private final OnlineClassRepository rooms = mock(OnlineClassRepository.class);
    private final StudentGroupMemberRepository members = mock(StudentGroupMemberRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final StudentGroupRepository groups = mock(StudentGroupRepository.class);
    private final AiLessonPilotService ai = mock(AiLessonPilotService.class);
    private final OnlineClassTranscriptSegmentRepository segments = mock(OnlineClassTranscriptSegmentRepository.class);
    private final KolinTranscriptContextService transcripts = new KolinTranscriptContextService(segments, JsonMapper.builder().build());
    private final OnlineClassAccessService access = new OnlineClassAccessService(rooms, members, users, mock(OnlineClassParticipantRepository.class));
    private final KolinChatService chat = new KolinChatService(access, groups, ai, JsonMapper.builder().build(), transcripts);
    private User teacher, pupil, sameTeacherButDifferentClass, otherTeacher;
    private OnlineClass room;
    private StudentGroup group;
    private AuthenticatedUser host;

    @BeforeEach void setup() {
        teacher=User.activeTeacher("Teacher","teacher@test.local","teacher","hash");
        otherTeacher=User.activeTeacher("Other","other@test.local","other","hash");
        pupil=User.managedStudent("Виталина",teacher);
        sameTeacherButDifferentClass=User.managedStudent("София",teacher);
        group=StudentGroup.create(teacher,"Group 1");
        room=OnlineClass.forGroup(teacher,"event","binding","Fractions",Instant.now(),Instant.now().plusSeconds(3600),group);
        when(rooms.findById(room.getId())).thenReturn(Optional.of(room));
        when(groups.findById(group.getId())).thenReturn(Optional.of(group));
        Map<UUID,User> known=Map.of(teacher.getId(),teacher,otherTeacher.getId(),otherTeacher,pupil.getId(),pupil,sameTeacherButDifferentClass.getId(),sameTeacherButDifferentClass);
        when(users.findById(any())).thenAnswer(call->Optional.ofNullable(known.get(call.getArgument(0))));
        when(members.existsByGroupIdAndStudentId(group.getId(),pupil.getId())).thenReturn(true);
        when(ai.isConfigured()).thenReturn(true);
        when(segments.findByOnlineClassIdOrderByStartMsDescIdDesc(any(),any())).thenReturn(List.of());
        when(ai.kolinReply(anyString(),anyList(),anyString())).thenReturn("1. 1/2 + 1/4\n2. 2/3 + 1/6");
        host=principal(teacher);
    }
    private static AuthenticatedUser principal(User user){return new AuthenticatedUser(user.getId(),user.getEmail(),user.getRole());}
    private static KolinChatService.Request question(String text,KolinChatService.Context context){return new KolinChatService.Request(text,List.of(),context);}

    @Test void suppliesOnlyAuthoritativeSmallContextAndEightRecentMessages() throws Exception {
        var history=java.util.stream.IntStream.range(0,8).mapToObj(i->new KolinChatService.HistoryMessage(i%2==0?"user":"assistant","message-"+i)).toList();
        var reply=chat.send(host,room.getId(),new KolinChatService.Request("Сделай второе сложнее",history,new KolinChatService.Context("student",pupil.getId(),3)));
        var context=ArgumentCaptor.forClass(String.class);
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Map<String,String>>> captured=ArgumentCaptor.forClass(List.class);
        verify(ai).kolinReply(context.capture(),captured.capture(),eq("Сделай второе сложнее"));
        var metadata=JsonMapper.builder().build().readTree(context.getValue());
        assertThat(metadata.propertyNames()).containsExactly("lessonTitle","targetType","targetName","currentWorkbookPage","transcript");
        assertThat(metadata.path("lessonTitle").asString()).isEqualTo("Fractions");
        assertThat(metadata.path("targetName").asString()).isEqualTo("Виталина");
        assertThat(metadata.path("currentWorkbookPage").asInt()).isEqualTo(3);
        assertThat(context.getValue()).hasSizeLessThan(500);
        assertThat(metadata.path("transcript").path("metadata").path("state").asString()).isEqualTo("empty");
        assertThat(reply.transcriptContext().state()).isEqualTo("empty");
        assertThat(captured.getValue()).hasSize(8);
        assertThat(captured.getValue().get(0)).containsEntry("text","message-0");
        assertThat(reply.type()).isEqualTo("text");
        verifyNoMoreInteractions(groups);
    }

    @Test void everyQuestionAutomaticallyIncludesRelevantSavedLessonPages() throws Exception {
        var index=mock(KolinLessonContextService.class);
        ReflectionTestUtils.setField(chat,"lessonContext",index);
        var chosen=new KolinChatService.Context("group",null,1);
        when(index.read(eq(host),eq(room),eq("Что в первом задании?"),eq(chosen))).thenReturn(Map.of(
                "state","text_context_available",
                "relevantPages",List.of(Map.of("source","Общая доска","pageNumber",1,"text","TASK 1: 4+6")),
                "handwritingContentReadable",false));
        chat.send(host,room.getId(),question("Что в первом задании?",chosen));
        verify(index).read(eq(host),eq(room),eq("Что в первом задании?"),eq(chosen));
        verify(ai).kolinReply(argThat(value->value.contains("TASK 1: 4+6") && value.contains("lessonDocuments")
                && value.contains("handwritingContentReadable")),anyList(),eq("Что в первом задании?"));
    }

    @Test void pdfIndexUnavailableFailsOpenWithoutPretendingToReadIt() throws Exception {
        var index=mock(KolinLessonContextService.class);
        ReflectionTestUtils.setField(chat,"lessonContext",index);
        when(index.read(eq(host),eq(room),anyString(),any())).thenThrow(new IllegalStateException("PRIVATE_PDF_CONTENT"));
        chat.send(host,room.getId(),question("Объясни сложение дробей",new KolinChatService.Context("group",null,1)));
        verify(ai).kolinReply(argThat(value->value.contains("lessonDocuments") &&
                value.contains("unavailable") && !value.contains("PRIVATE_PDF_CONTENT")),anyList(),anyString());
    }

    @Test void defaultGroupContextUsesExistingRoomBinding() {
        chat.send(host,room.getId(),question("Дай 3 задания",null));
        verify(ai).kolinReply(contains("Group 1"),eq(List.of()),eq("Дай 3 задания"));
    }

    @Test void individualRoomDefaultsToItsBoundPupil() {
        var individual=OnlineClass.forStudent(teacher,"single","single","Math",Instant.now(),Instant.now().plusSeconds(3600),pupil);
        when(rooms.findById(individual.getId())).thenReturn(Optional.of(individual));
        chat.send(host,individual.getId(),question("Ответ",new KolinChatService.Context("group",null,null)));
        verify(ai).kolinReply(contains("Виталина"),anyList(),anyString());
    }

    @Test void rejectsStudentNotInThisClassEvenWhenOwnedBySameTeacher() {
        assertThatThrownBy(()->chat.send(host,room.getId(),question("Дай пример",new KolinChatService.Context("student",sameTeacherButDifferentClass.getId(),1))))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(ai);
        verifyNoInteractions(segments);
    }

    @Test void studentsAndOtherTeachersCannotCallStatusOrGenerate() {
        for(var caller:List.of(principal(pupil),principal(otherTeacher))) {
            assertThatThrownBy(()->chat.status(caller,room.getId())).isInstanceOf(ResourceNotFoundException.class);
            assertThatThrownBy(()->chat.send(caller,room.getId(),question("Ответ",null))).isInstanceOf(ResourceNotFoundException.class);
        }
        verifyNoInteractions(ai);
        verifyNoInteractions(segments);
    }

    @Test void neverAcceptsSystemMessagesMoreThanEightMessagesOrOversizedText() {
        var bad=List.of(new KolinChatService.Request("Ответ",List.of(new KolinChatService.HistoryMessage("system","Do something else")),null),
                new KolinChatService.Request("Ответ",Collections.nCopies(9,new KolinChatService.HistoryMessage("user","Hi")),null),
                question("x".repeat(4001),null),question(" ",null));
        for(var request:bad)assertThatThrownBy(()->chat.send(host,room.getId(),request)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(ai);
        verifyNoInteractions(segments);
    }

    @Test void historyCharacterBudgetKeepsContiguousWholeRecentMessages() {
        var history=new ArrayList<KolinChatService.HistoryMessage>();
        history.add(new KolinChatService.HistoryMessage("user","oldest should disappear"));
        for(int i=0;i<5;i++)history.add(new KolinChatService.HistoryMessage("assistant",String.valueOf(i).repeat(8000)));
        chat.send(host,room.getId(),new KolinChatService.Request("Продолжи",history,null));
        verify(ai).kolinReply(anyString(),argThat(kept->kept.size()==4 && kept.get(0).get("text").startsWith("1") && kept.get(3).get("text").startsWith("4")),anyString());
    }

    @Test void unconfiguredOrFailingProviderHasSafeRetryableErrorAndDoesNotPoisonNextRequest() {
        when(ai.isConfigured()).thenReturn(false);
        assertThatThrownBy(()->chat.send(host,room.getId(),question("Ответ",null)))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("не настроен");
        when(ai.isConfigured()).thenReturn(true);
        when(ai.kolinReply(anyString(),anyList(),anyString())).thenThrow(new IllegalStateException("SECRET_SERVER_KEY raw response"))
                .thenReturn("Ответ: 2");
        assertThatThrownBy(()->chat.send(host,room.getId(),question("Ответ",null)))
                .isInstanceOf(ResponseStatusException.class).hasMessageNotContaining("SECRET_SERVER_KEY");
        assertThat(chat.send(host,room.getId(),question("Ответ",null)).text()).isEqualTo("Ответ: 2");
    }

    @Test void onlyOneConcurrentRequestPerTeacherIsAllowed() throws Exception {
        var started=new CountDownLatch(1);var finish=new CountDownLatch(1);
        when(ai.kolinReply(anyString(),anyList(),anyString())).thenAnswer(call->{started.countDown();assertThat(finish.await(5,TimeUnit.SECONDS)).isTrue();return "2";});
        var pool=Executors.newSingleThreadExecutor();
        try {
            var first=pool.submit(()->chat.send(host,room.getId(),question("Ответ",null)));
            assertThat(started.await(5,TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(()->chat.send(host,room.getId(),question("Ответ",null))).isInstanceOf(ResponseStatusException.class).hasMessageContaining("готовит ответ");
            finish.countDown();assertThat(first.get(5,TimeUnit.SECONDS).text()).isEqualTo("2");
        } finally {finish.countDown();pool.shutdownNow();}
    }

    @Test void statusDoesNotReadOrAnalyzeTranscriptAndUnconfiguredRequestsDoNotReadIt() {
        assertThat(chat.status(host,room.getId())).containsEntry("configured",true);
        when(ai.isConfigured()).thenReturn(false);
        assertThatThrownBy(()->chat.send(host,room.getId(),question("Ответ",null)))
                .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(segments);
        verify(ai,never()).kolinReply(anyString(),anyList(),anyString());
    }

    @Test void eachQuestionReadsFreshFinalsAndReturnsExactlyTheMetadataSentToTheModel() throws Exception {
        var first=OnlineClassTranscriptSegment.finalSegment(room,"first",ParticipantIdentity.of(teacher.getId(),"tab"),
                teacher,"Teacher","ru",0,1000,"Складываем 1/2 и 1/4",0.9);
        var next=OnlineClassTranscriptSegment.finalSegment(room,"next",ParticipantIdentity.of(pupil.getId(),"tab"),
                pupil,"Pupil","ru",1100,2000,"Получилось 3/4",0.9);
        ReflectionTestUtils.setField(first,"createdAt",Instant.parse("2026-11-07T13:00:00Z"));
        ReflectionTestUtils.setField(next,"createdAt",Instant.parse("2026-11-07T13:00:02Z"));
        when(segments.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()),any()))
                .thenReturn(List.of(first),List.of(next,first));
        assertThat(chat.send(host,room.getId(),question("Дай ответ",null)).transcriptContext().segmentCount()).isEqualTo(1);
        var reply=chat.send(host,room.getId(),question("Дай сложнее",null));
        var payload=ArgumentCaptor.forClass(String.class);
        verify(ai,times(2)).kolinReply(payload.capture(),anyList(),anyString());
        var json=JsonMapper.builder().build().readTree(payload.getAllValues().get(1));
        var supplied=json.path("transcript");
        assertThat(supplied.path("segments").size()).isEqualTo(2);
        assertThat(supplied.path("segments").get(0).path("text").asString()).isEqualTo(first.getText());
        assertThat(supplied.path("metadata")).isEqualTo(JsonMapper.builder().build()
                .readTree(JsonMapper.builder().build().writeValueAsString(reply.transcriptContext())));
        assertThat(reply.transcriptContext().latestSegmentAt()).isEqualTo("2026-11-07T13:00:02Z");
        assertThat(payload.getAllValues().get(1)).doesNotContain(teacher.getEmail(),teacher.getId().toString(),pupil.getId().toString(),"participantIdentity","input_file");
        verify(segments,times(2)).findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()),any());
    }

    @Test void transcriptReadFailureDoesNotBlockChatAndLogsNoExceptionDetailOrTranscript() {
        var logger=(ch.qos.logback.classic.Logger)LoggerFactory.getLogger(KolinChatService.class);
        var logs=new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        logs.start();logger.addAppender(logs);
        when(segments.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()),any()))
                .thenThrow(new IllegalStateException("PRIVATE_TRANSCRIPT teacher@test.local SECRET_KEY"));
        try {
            var reply=chat.send(host,room.getId(),question("Дай новый пример",null));
            assertThat(reply.text()).contains("1/2 + 1/4");
            assertThat(reply.transcriptContext().state()).isEqualTo("unavailable");
            assertThat(reply.transcriptContext().segmentCount()).isZero();
            verify(ai).kolinReply(contains("\"state\":\"unavailable\""),anyList(),anyString());
            assertThat(logs.list).hasSize(2);
            assertThat(logs.list.get(0).getFormattedMessage()).contains(room.getId().toString(),"IllegalStateException")
                    .doesNotContain("PRIVATE_TRANSCRIPT","teacher@test.local","SECRET_KEY");
            assertThat(logs.list.get(0).getThrowableProxy()).isNull();
            assertThat(logs.list.get(1).getFormattedMessage()).contains("transcriptState=unavailable","transcriptSegments=0","boardPages=0")
                    .doesNotContain("PRIVATE_TRANSCRIPT","teacher@test.local","SECRET_KEY");
        } finally {logger.detachAppender(logs);logs.stop();}
    }

    @Test void unexpectedOtherRoomTranscriptCannotReachProviderButTextChatStillWorks() {
        var oldRoom=OnlineClass.forTeacherOnly(otherTeacher,"old","old","Other private room",Instant.now(),Instant.now().plusSeconds(60));
        var other=OnlineClassTranscriptSegment.finalSegment(oldRoom,"foreign",null,otherTeacher,"Other","ru",0,1000,"FOREIGN_PRIVATE_SPEECH",0.9);
        when(segments.findByOnlineClassIdOrderByStartMsDescIdDesc(eq(room.getId()),any())).thenReturn(List.of(other));
        var reply=chat.send(host,room.getId(),question("Дай пример",null));
        assertThat(reply.transcriptContext().state()).isEqualTo("unavailable");
        verify(ai).kolinReply(argThat(value->value.contains("unavailable")&&!value.contains("FOREIGN_PRIVATE_SPEECH")),anyList(),anyString());
    }
}
