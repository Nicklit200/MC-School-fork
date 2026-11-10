package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.*;
import com.mcschool.flashcard.groups.StudentGroup;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class KolinBoardReviewServiceTest {
    final OnlineClassAccessService access=mock(OnlineClassAccessService.class);
    final KolinTaskRoster roster=mock(KolinTaskRoster.class);
    final OnlineClassDocumentService documents=mock(OnlineClassDocumentService.class);
    final KolinBoardReviewService service=new KolinBoardReviewService(access,roster,documents);
    final User teacher=User.activeTeacher("QA","qa@example.test","qa","hash");
    final User melissa=User.managedStudent("Мелисса",teacher),sofia=User.managedStudent("София",teacher);
    final OnlineClass room=OnlineClass.forGroup(teacher,"event","event","Lesson",Instant.now(),Instant.now().plusSeconds(3600),StudentGroup.create(teacher,"Group"));
    final AuthenticatedUser host=new AuthenticatedUser(teacher.getId(),teacher.getEmail(),Role.TEACHER);
    KolinBoardReviewServiceTest() {
        when(access.requireHost(host,room.getId())).thenReturn(room);
        when(roster.read(room)).thenReturn(List.of(new KolinTaskRoster.Pupil(melissa.getId(),melissa.getFullName()),new KolinTaskRoster.Pupil(sofia.getId(),sofia.getFullName())));
    }
    @ParameterizedTest @ValueSource(strings={"Проверь задание у Мелиссы","Проверь Мелиссу","Посмотри решение Мелиссы","Prüfe Melissas Lösung","Check Melissa's work"})
    void exactNamedPupilOverridesTeachersSelectedBoard(String question) {
        var target=service.resolve(host,room.getId(),new KolinBoardReviewService.TargetRequest(question,new KolinChatService.Context("student",sofia.getId(),8)));
        assertThat(target.studentId()).isEqualTo(melissa.getId());
        assertThat(target.state()).isEqualTo("ready");
    }
    @Test void unknownOrAmbiguousNamesNeverFallBackToAnotherPupil() {
        var context=new KolinChatService.Context("student",melissa.getId(),1);
        for(String question:List.of("Проверь задание у Маши","Проверь Мелиссу и Софию","Проверь решение Анны",
                "Проверь решение анны","Проверь Машино решение","Проверь Анну"))
            assertThat(service.resolve(room,question,context).state()).as(question).isEqualTo("clarify");
        when(roster.read(room)).thenReturn(List.of(new KolinTaskRoster.Pupil(melissa.getId(),"Мелисса А"),new KolinTaskRoster.Pupil(sofia.getId(),"Мелисса Б")));
        assertThat(service.resolve(room,"Проверь Мелиссу",context).state()).isEqualTo("clarify");
    }
    @Test void ordinaryRequestsDoNotCaptureBoardAndSelectedPupilCanBeReviewedWithoutAName() {
        var context=new KolinChatService.Context("student",melissa.getId(),8);
        for(String question:List.of("Дай задания Мелиссе","Как объяснить дроби?","Проверь решение: 2+2=4"))
            assertThat(service.resolve(room,question,context).state()).isEqualTo("not_requested");
        assertThat(service.resolve(room,"Проверь решение",context).studentId()).isEqualTo(melissa.getId());
        assertThat(service.resolve(room,"Проверь задание",null).state()).isEqualTo("clarify");
        assertThat(service.resolve(room,"Проверь Софию",context).studentId()).isEqualTo(sofia.getId());
    }
    @Test void endpointChecksHostBeforeRosterAccess() {
        reset(access,roster);
        when(access.requireHost(any(),any())).thenThrow(new com.mcschool.flashcard.common.ResourceNotFoundException("No lesson"));
        assertThatThrownBy(()->service.resolve(host,room.getId(),new KolinBoardReviewService.TargetRequest("Проверь Мелиссу",null)))
                .isInstanceOf(com.mcschool.flashcard.common.ResourceNotFoundException.class);
        verifyNoInteractions(roster,documents);
    }
    KolinBoardReviewService.Snapshot snapshot(UUID pupil,String board,String image) {
        return new KolinBoardReviewService.Snapshot(pupil,board,3,4,9,Instant.now().minusSeconds(2),Instant.now(),image);
    }
    static String jpeg(int width,int height) throws Exception {
        var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB),"jpeg",out);
        return "data:image/jpeg;base64,"+Base64.getEncoder().encodeToString(out.toByteArray());
    }
    @Test void acceptsBoundedJpegAndReturnsAuthoritativeNameWithoutImage() throws Exception {
        var shot=snapshot(melissa.getId(),PersonalBoard.workbookTargetIdFor(melissa.getId()),jpeg(160,240));
        var receipt=service.validate(room,"Проверь задание у Мелиссы",null,shot);
        assertThat(receipt.studentName()).isEqualTo("Мелисса");
        assertThat(receipt.pageNumber()).isEqualTo(3);
        assertThat(receipt.imageSha256()).matches("[a-f0-9]{64}");
        assertThat(receipt.toString()).doesNotContain("base64");
    }
    @Test void rejectsCrossPupilAndNonBoardSources() throws Exception {
        String image=jpeg(32,32);
        for(var shot:List.of(snapshot(sofia.getId(),PersonalBoard.targetIdFor(sofia.getId()),image),
                snapshot(melissa.getId(),PersonalBoard.targetIdFor(sofia.getId()),image),snapshot(melissa.getId(),"board-1",image),
                snapshot(UUID.randomUUID(),"camera",image)))
            assertThatThrownBy(()->service.validate(room,"Проверь Мелиссу",null,shot)).isInstanceOf(KolinRequestException.class);
    }
    @Test void rejectsRemoteMalformedOversizeAndHugePixelImages() throws Exception {
        for(String image:List.of("https://example.test/private.jpg","data:image/jpeg;base64,broken",jpeg(3073,32),jpeg(31,32),
                "data:image/jpeg;base64,"+"A".repeat(2_000_001)))
            assertThatThrownBy(()->service.validate(room,"Проверь Мелиссу",null,snapshot(melissa.getId(),PersonalBoard.targetIdFor(melissa.getId()),image)))
                    .isInstanceOf(KolinRequestException.class);
    }
    @Test void staleViewAndReplacedPdfCannotReachModel() throws Exception {
        var shot=snapshot(melissa.getId(),PersonalBoard.workbookTargetIdFor(melissa.getId()),jpeg(32,32));
        var stale=new KolinBoardReviewService.Snapshot(shot.studentId(),shot.boardId(),3,4,9,Instant.now().minusSeconds(90),Instant.now(),shot.imageDataUrl());
        assertThatThrownBy(()->service.validate(room,"Проверь Мелиссу",null,stale)).isInstanceOf(KolinRequestException.class);
        when(documents.workbookVersion(host,room.getId(),shot.boardId())).thenReturn(4L);
        service.requireCurrent(host,room.getId(),shot);
        when(documents.workbookVersion(host,room.getId(),shot.boardId())).thenReturn(5L);
        assertThatThrownBy(()->service.requireCurrent(host,room.getId(),shot)).isInstanceOf(KolinRequestException.class);
    }
    @Test void wholeWorkbookRequiresEveryPageAndCanUseSavedWorkWithoutALiveView() throws Exception {
        String image=jpeg(32,32), board=PersonalBoard.workbookTargetIdFor(melissa.getId());
        var shot=new KolinBoardReviewService.Snapshot(melissa.getId(),board,1,4,0,null,Instant.now(),image,
                "workbook",2,List.of(new KolinBoardReviewService.Page(2,8,image)));
        var receipt=service.validate(room,"Что неправильно решила Мелисса?",null,shot);
        assertThat(receipt.scope()).isEqualTo("workbook");assertThat(receipt.pages()).hasSize(2);
        for(var extra:List.of(List.<KolinBoardReviewService.Page>of(),List.of(new KolinBoardReviewService.Page(1,8,image)))) {
            var incomplete=new KolinBoardReviewService.Snapshot(melissa.getId(),board,1,4,0,null,Instant.now(),image,"workbook",2,extra);
            assertThatThrownBy(()->service.validate(room,"Проверь всю тетрадь у Мелиссы",null,incomplete)).isInstanceOf(KolinRequestException.class);
        }
    }
    @Test void firstTwoExercisesResolveOnSharedBoardWithoutInventingPupil() {
        var group=new KolinChatService.Context("group",null,1);
        var first=service.resolve(room,"Объясни первое и второе задание",group);
        assertThat(first.state()).isEqualTo("ready");
        assertThat(first.studentId()).isNull();
        assertThat(first.scope()).isEqualTo("first_page");
        var explicit=service.resolve(room,"Посмотри первую страницу на общей доске",new KolinChatService.Context("student",melissa.getId(),1));
        assertThat(explicit.studentId()).isNull();
        assertThat(explicit.scope()).isEqualTo("first_page");
        var named=service.resolve(room,"Объясни первое задание Мелиссы",group);
        assertThat(named.studentId()).isEqualTo(melissa.getId());
    }

    @Test void sharedBoardSnapshotHasNoPupilAndCannotBeReplacedByPersonalSnapshot() throws Exception {
        String image=jpeg(80,120);
        var shot=new KolinBoardReviewService.Snapshot(null,"board-1",1,7,2,null,Instant.now(),image,
                "first_page",4,List.of());
        var result=service.validate(room,"Посмотри первую страницу на общей доске",
                new KolinChatService.Context("group",null,1),shot);
        assertThat(result.studentId()).isNull();
        assertThat(result.boardId()).isEqualTo("board-1");
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(7L);
        service.requireCurrent(host,room.getId(),shot);
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(8L);
        assertThatThrownBy(()->service.requireCurrent(host,room.getId(),shot))
                .isInstanceOf(KolinRequestException.class);
        var spoof=new KolinBoardReviewService.Snapshot(melissa.getId(),PersonalBoard.workbookTargetIdFor(melissa.getId()),
                1,7,2,null,Instant.now(),image,"first_page",4,List.of());
        assertThatThrownBy(()->service.validate(room,"Посмотри первую страницу на общей доске",
                new KolinChatService.Context("group",null,1),spoof))
                .isInstanceOf(KolinRequestException.class);
    }

}
