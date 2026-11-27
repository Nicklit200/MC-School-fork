package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.liveclasses.OnlineClassAccessService;
import com.mcschool.flashcard.liveclasses.OnlineClassRepository;
import com.mcschool.flashcard.skills.SkillBoardService;
import com.mcschool.flashcard.skills.SkillEvidenceService;
import com.mcschool.flashcard.skills.SkillMasteryService;
import com.mcschool.flashcard.users.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PostLessonSkillReviewParticipationTest {
    @Test void noAttendanceOrPupilActivityMeansNoSkillReviewTarget() {
        verifyParticipation(false);
    }

    @Test void confirmedAttendanceOrAuthenticatedWorkAllowsReview() {
        verifyParticipation(true);
    }

    private void verifyParticipation(boolean eligible) {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        var service=new PostLessonSkillReviewService(jdbc,new ObjectMapper(),
                mock(PlatformTransactionManager.class),mock(OnlineClassRepository.class),
                mock(OnlineClassAccessService.class),mock(LessonParticipantsService.class),
                mock(StudentGroupMemberRepository.class),mock(UserRepository.class),
                mock(SkillBoardService.class),mock(SkillMasteryService.class),
                mock(SkillEvidenceService.class),mock(LessonPreparationRepository.class),
                mock(PostLessonSkillAnalysisService.class));
        UUID classId=UUID.randomUUID();
        UUID pupil=UUID.randomUUID();
        when(jdbc.queryForObject(anyString(),eq(Boolean.class),
                any(),any(),any(),any(),any(),any(),any(),any(),any()))
                .thenReturn(eligible);

        assertThat(service.participated(classId,pupil)).isEqualTo(eligible);
        verify(jdbc).queryForObject(argThat(sql->
                sql.contains("first_joined_at IS NOT NULL")
                && sql.contains("online_class_annotation_events")
                && sql.contains("online_class_transcript_segments")
                && !sql.contains("admission_state='ADMITTED'")),
                eq(Boolean.class),eq(classId),eq(pupil),eq(classId),
                eq("personal-"+pupil),eq("personal-workbook-"+pupil),
                eq(pupil),eq(pupil),eq(classId),eq(pupil));
        service.close();
    }
}
