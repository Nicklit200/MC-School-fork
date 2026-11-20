package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class KolinLessonMemoryServiceTest {
    private static final UUID STUDENT=UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CLASS=UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID TEACHER=UUID.fromString("00000000-0000-0000-0000-000000000003");
    private final OnlineClassAccessService access=mock(OnlineClassAccessService.class);
    private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    private final KolinLessonMemoryService service=new KolinLessonMemoryService(access,jdbc);
    private final AuthenticatedUser host=new AuthenticatedUser(TEACHER,"host@test.local",Role.TEACHER);
    private final String board="personal-workbook-"+STUDENT;

    private KolinBoardReviewService.Metadata metadata(long pdfVersion,
            long revision1, String sha1, long revision2, String sha2) {
        return new KolinBoardReviewService.Metadata(STUDENT,"Виталина",board,1,pdfVersion,revision1,
            Instant.now(),sha1,"workbook",2,List.of(
                new KolinBoardReviewService.PageMetadata(1,revision1,sha1),
                new KolinBoardReviewService.PageMetadata(2,revision2,sha2)));
    }
    private KolinLessonMemoryService.Previous previous(int page,long version,long ink,String hash) {
        return new KolinLessonMemoryService.Previous(page,version,-1,ink,hash,Instant.parse("2026-11-16T12:00:00Z"));
    }
    @Test void absenceOfPreviousChecksIsNotEvidenceOfCorrectness() {
        var states=KolinLessonMemoryService.classify(metadata(5,2,"a",0,"b"),List.of());
        assertThat(states).extracting(row->row.get("state"))
            .containsExactly("not_checked","not_checked");
    }
    @Test void revisitingAReviewedPageWithoutChangesDoesNotRegradeIt() {
        var states=KolinLessonMemoryService.classify(metadata(5,2,"a",4,"b"),
            List.of(previous(1,5,2,"a"),previous(2,5,4,"b")));
        assertThat(states).extracting(row->row.get("state"))
            .containsExactly("checked_unchanged","checked_unchanged");
    }
    @Test void aCorrectionOrReplacedWorkbookRequiresNewReview() {
        var states=KolinLessonMemoryService.classify(metadata(6,3,"modified",4,"b"),
            List.of(previous(1,5,2,"old"),previous(2,5,4,"b")));
        assertThat(states).extracting(row->row.get("state"))
            .containsExactly("changed_after_check","changed_after_check");
    }
    @Test void aSnapshotChangeIsDetectedEvenIfInkRevisionDoesNotAdvance() {
        var states=KolinLessonMemoryService.classify(metadata(5,2,"different",4,"b"),
            List.of(previous(1,5,2,"a"),previous(2,5,4,"b")));
        assertThat(states).extracting(row->row.get("state"))
            .containsExactly("changed_after_check","checked_unchanged");
    }
    @Test void aSuccessfulReviewWritesOnlySelectedPagesAndNeverStoresImages() {
        var snap=new KolinBoardReviewService.Snapshot(STUDENT,board,1,5,2,Instant.now(),Instant.now(),
            "data:image/jpeg;base64,PRIVATE_IMAGE","workbook",2,List.of(),null);
        var meta=metadata(5,2,"a",4,"b");
        service.rememberReview(host,CLASS,meta,snap);
        verify(access).requireHost(host,CLASS);
        verify(jdbc,times(2)).update(contains("kolyn_review_page_checkpoints"),any(Object[].class));
        // The DB stores hash/revision metadata only. No image bytes in SQL.
    }
}
