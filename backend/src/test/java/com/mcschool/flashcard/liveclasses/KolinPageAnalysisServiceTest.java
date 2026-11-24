package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.AiLessonPilotService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class KolinPageAnalysisServiceTest {
    final OnlineClassAccessService access=mock(OnlineClassAccessService.class);
    final KolinTaskRoster roster=mock(KolinTaskRoster.class);
    final OnlineClassDocumentService documents=mock(OnlineClassDocumentService.class);
    final KolinBoardReviewService reviews=mock(KolinBoardReviewService.class);
    final KolinPageAnalysisStore store=mock(KolinPageAnalysisStore.class);
    final AiLessonPilotService ai=mock(AiLessonPilotService.class);
    final KolinPageAnalysisService service=new KolinPageAnalysisService(access,roster,documents,reviews,store,ai,new ObjectMapper());
    final User teacher=User.activeTeacher("Teacher","teacher@example.test","teacher","hash");
    final User pupil=User.managedStudent("Pupil",teacher);
    final AuthenticatedUser host=new AuthenticatedUser(teacher.getId(),teacher.getEmail(),Role.TEACHER);
    final OnlineClass room=OnlineClass.forStudent(teacher,"event","event","Lesson",Instant.now(),Instant.now().plusSeconds(3600),pupil);
    final String board=PersonalBoard.targetIdFor(pupil.getId());
    final Instant now=Instant.now();
    final KolinBoardReviewService.Snapshot snapshot=new KolinBoardReviewService.Snapshot(pupil.getId(),
            board,2,0,7,null,now,"data:image/jpeg;base64,example","task_page",5,List.of(),3L);
    final KolinPageAnalysisStore.Key key=new KolinPageAnalysisStore.Key(room.getId(),host.id(),pupil.getId(),board,2,0,3,7);
    final UUID id=UUID.randomUUID();
    final KolinBoardReviewService.Metadata metadata=new KolinBoardReviewService.Metadata(pupil.getId(),"Pupil",board,
            2,0,7,now,"a".repeat(64),"task_page",5,List.of(new KolinBoardReviewService.PageMetadata(2,7,"a".repeat(64))));

    KolinPageAnalysisStore.Result receipt(String state,String text) {
        return new KolinPageAnalysisStore.Result(id,pupil.getId(),board,2,0,3,7,state,text,null,now,now);
    }

    @BeforeEach void setup() {
        org.springframework.test.util.ReflectionTestUtils.setField(service,"pilotTeacherId",host.id().toString());
        room.start(now);
        when(access.requireHost(host,room.getId())).thenReturn(room);
        when(roster.read(room)).thenReturn(List.of(new KolinTaskRoster.Pupil(pupil.getId(),"Pupil")));
        when(reviews.validatePersonalPage(room,snapshot)).thenReturn(metadata);
        when(store.hasPupilInk(key)).thenReturn(true);
        when(ai.isConfigured()).thenReturn(true);
    }

    @Test void duplicateRevisionReturnsReceiptWithoutVision() {
        var ready=receipt("READY","Found an error");
        when(store.claim(key,metadata.imageSha256())).thenReturn(new KolinPageAnalysisStore.Claim(false,ready));
        assertThat(service.analyze(host,room.getId(),snapshot)).isEqualTo(ready);
        verifyNoInteractions(ai);
        verify(store,never()).finish(any(),any(),any());
    }

    @Test void newlyClaimedRevisionCallsVisionOnlyOnceAndStoresText() {
        var running=receipt("RUNNING",null);
        var ready=receipt("READY","Found an error");
        when(store.claim(key,metadata.imageSha256()))
                .thenReturn(new KolinPageAnalysisStore.Claim(true,running),new KolinPageAnalysisStore.Claim(false,ready));
        when(ai.kolinReviewReply(anyString(),anyList(),anyString(),anyList())).thenReturn(ready.text());
        when(store.finish(key,id,ready.text())).thenReturn(ready);
        assertThat(service.analyze(host,room.getId(),snapshot)).isEqualTo(ready);
        assertThat(service.analyze(host,room.getId(),snapshot)).isEqualTo(ready);
        verify(ai,times(1)).kolinReviewReply(anyString(),anyList(),anyString(),anyList());
        verify(store,times(1)).finish(key,id,ready.text());
    }

    @Test void noPupilInkNeverClaimsOrCallsVision() {
        when(store.hasPupilInk(key)).thenReturn(false);
        assertThatThrownBy(()->service.analyze(host,room.getId(),snapshot)).isInstanceOf(KolinRequestException.class);
        verify(store,never()).claim(any(),anyString());
        verifyNoInteractions(ai);
    }

    @Test void changedSnapshotNeverClaimsOrCallsVision() {
        doThrow(KolinRequestException.reviewUnavailable()).when(reviews).requireCurrent(host,room.getId(),snapshot);
        assertThatThrownBy(()->service.analyze(host,room.getId(),snapshot)).isInstanceOf(KolinRequestException.class);
        verifyNoInteractions(store,ai);
    }

    @Test void foreignPupilCannotReadSavedAnalyses() {
        assertThatThrownBy(()->service.current(host,room.getId(),UUID.randomUUID())).isInstanceOf(KolinRequestException.class);
        verifyNoInteractions(store,ai);
    }

    @Test void textContextIncludesOnlyReadyReceiptsAndReportsLimits() {
        var context=new HashMap<String,Object>();
        assertThat(KolinChatService.includePageAnalyses(context,List.of(receipt("RUNNING",null),receipt("READY","saved facts")))).isTrue();
        assertThat(context.get("savedPageAnalyses")).isEqualTo(List.of(receipt("READY","saved facts")));
        assertThat(context).containsKey("savedPageAnalysisCoverage");
    }

    @Test void disabledPilotCannotClaimOrCallProvider() {
        org.springframework.test.util.ReflectionTestUtils.setField(service,"pilotTeacherId","");
        assertThat(service.enabled(host,room.getId())).isFalse();
        assertThat(service.candidates(host,room.getId())).isEmpty();
        assertThatThrownBy(()->service.analyze(host,room.getId(),snapshot)).isInstanceOf(KolinRequestException.class);
        verifyNoInteractions(store,ai);
    }

    @Test void keyRejectsOtherPupilsBoardAndSharedBoard() {
        for(String wrong:List.of("board-1",PersonalBoard.targetIdFor(UUID.randomUUID()))) {
            assertThatThrownBy(()->new KolinPageAnalysisStore.Key(room.getId(),host.id(),pupil.getId(),wrong,2,0,3,7))
                    .isInstanceOf(KolinRequestException.class);
        }
    }
}
