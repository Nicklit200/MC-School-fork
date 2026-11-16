package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.lessons.StudentLessonHistoryService;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryDetail;
import com.mcschool.flashcard.lessons.dto.StudentLessonHistoryItem;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class KolinStudentHistoryContextServiceTest {
    private final KolinTaskRoster roster=mock(KolinTaskRoster.class);
    private final StudentLessonHistoryService history=mock(StudentLessonHistoryService.class);
    private final HomeworkRepository homework=mock(HomeworkRepository.class);
    private final KolinStudentHistoryContextService service=
        new KolinStudentHistoryContextService(roster,history,homework);
    private final User teacher=User.activeTeacher("Teacher","teacher@test.local","teacher","hash");
    private final User vitalina=User.managedStudent("Виталина",teacher);
    private final User melissa=User.managedStudent("Мелисса",teacher);
    private final OnlineClass room=OnlineClass.forGroup(teacher,"current","current","Lesson",
        Instant.now(),Instant.now().plusSeconds(3600),StudentGroup.create(teacher,"Group"));
    private final AuthenticatedUser host=new AuthenticatedUser(teacher.getId(),teacher.getEmail(),Role.TEACHER);
    KolinStudentHistoryContextServiceTest() {
        when(roster.read(room)).thenReturn(List.of(
            new KolinTaskRoster.Pupil(vitalina.getId(),vitalina.getFullName()),
            new KolinTaskRoster.Pupil(melissa.getId(),melissa.getFullName())));
    }

    @Test void explicitPupilOverridesWrongSelectedTabAndFetchesPreviousLessonEvidence() {
        UUID previousTeacher=UUID.randomUUID();
        Instant from=Instant.parse("2026-11-09T15:00:00Z"),to=from.plusSeconds(3600);
        var item=new StudentLessonHistoryItem(previousTeacher,"Previous teacher","past-001",
            "Brüche","Gruppe 1",from,to,true,false,true);
        var detail=new StudentLessonHistoryDetail(previousTeacher,"Previous teacher","past-001",
            "Brüche","Gruppe 1",from,to,
            "Die Brüche kürzen und erweitern üben","Beim Kürzen durch ungleiche Zahlen",
            "Brüche und Terme wiederholen","Bruchrechnen",null,true,"Arbeitsheft.pdf",
            false,null,true,"Transkript.pdf","Wir haben Brüche erklärt und wiederholt");
        when(history.list(host,vitalina.getId())).thenReturn(List.of(item));
        when(history.detail(host,vitalina.getId(),previousTeacher,"past-001")).thenReturn(detail);
        when(homework.findAllByStudentIdOrderByStartDateDescCreatedAtDesc(vitalina.getId())).thenReturn(List.of());
        var result=service.read(host,room,"Что мы проходили с Виталиной на прошлом уроке?",
            new KolinChatService.Context("student",melissa.getId(),1));
        assertThat(result.get("state")).isEqualTo("available");
        assertThat(result.get("studentId")).isEqualTo(vitalina.getId().toString());
        assertThat(result.toString()).contains("Bruchrechnen","Beim Kürzen","2026-11-09");
        verify(history).list(host,vitalina.getId());
        verify(history,never()).list(host,melissa.getId());
    }

    @Test void ambiguousNamesNeverCombinePrivatePupilHistory() {
        var result=service.read(host,room,"Что проходили Виталина и Мелисса на прошлых уроках?",null);
        assertThat(result.get("state")).isEqualTo("ambiguous_student");
        verifyNoInteractions(history,homework);
    }

    @Test void assignmentPermissionsAreCheckedBeforeReturningAnyHistoricRecord() {
        when(history.list(host,vitalina.getId())).thenThrow(new ResourceNotFoundException("Not assigned"));
        var result=service.read(host,room,"Что было на прошлом занятии Виталины?",null);
        assertThat(result.get("state")).isEqualTo("not_authorized");
        verifyNoInteractions(homework);
    }

    @Test void unrelatedChatDoesNotReadOtherLessonRecords() {
        var result=service.read(host,room,"Привет",new KolinChatService.Context("student",vitalina.getId(),1));
        assertThat(result.get("state")).isEqualTo("not_requested");
        verifyNoInteractions(history,homework);
    }

    @Test void aPupilOutsideThisRoomIsNeverQueried() {
        var outside=UUID.randomUUID();
        var result=service.read(host,room,"Расскажи о прошлых уроках",new KolinChatService.Context("student",outside,1));
        assertThat(result.get("state")).isEqualTo("not_authorized");
        verifyNoInteractions(history,homework);
    }
}
