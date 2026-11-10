package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;

class KolinLessonContextServiceTest {
    private final User teacher = User.activeTeacher("Teacher", "teacher@test.local", "teacher", "hash");
    private final User melissa = User.managedStudent("Мелисса", teacher);
    private final User sofia = User.managedStudent("София", teacher);
    private final OnlineClass room = OnlineClass.forGroup(teacher, "event","binding","Math",
        Instant.now(),Instant.now().plusSeconds(3600),StudentGroup.create(teacher,"Group 1"));
    private final AuthenticatedUser host = new AuthenticatedUser(teacher.getId(),teacher.getEmail(),Role.TEACHER);
    private final OnlineClassDocumentService documents = mock(OnlineClassDocumentService.class);
    private final KolinTaskRoster roster = mock(KolinTaskRoster.class);
    private final OnlineClassAnnotationDocumentRepository annotations = mock(OnlineClassAnnotationDocumentRepository.class);
    private final KolinLessonContextService service = new KolinLessonContextService(documents,roster,annotations);

    private byte[] pdf(String text) throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            try (PDPageContentStream page = new PDPageContentStream(document,document.getPage(0))) {
                page.beginText();
                page.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);
                page.newLineAtOffset(44,700);
                page.showText(text);
                page.endText();
            }
            document.save(out);
            return out.toByteArray();
        }
    }

    private byte[] pdfPages(String... texts) throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (String text : texts) {
                var sheet=new PDPage();
                document.addPage(sheet);
                try (PDPageContentStream canvas = new PDPageContentStream(document,sheet)) {
                    canvas.beginText();
                    canvas.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);
                    canvas.newLineAtOffset(44,700);
                    canvas.showText(text);
                    canvas.endText();
                }
            }
            document.save(out);
            return out.toByteArray();
        }
    }

    private void rosterAndInk() {
        when(roster.read(room)).thenReturn(List.of(
            new KolinTaskRoster.Pupil(melissa.getId(),melissa.getFullName()),
            new KolinTaskRoster.Pupil(sofia.getId(),sofia.getFullName())));
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
    }

    @SuppressWarnings("unchecked")
    @Test void autoRetrievesCommonAndRelevantPersonalPdfTextWithoutAnswerKeys() throws Exception {
        rosterAndInk();
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(5L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdf("TASK 1: 4+6=10")));
        String melissaBoard = PersonalBoard.workbookTargetIdFor(melissa.getId());
        when(documents.workbookVersion(host,room.getId(),melissaBoard)).thenReturn(7L);
        when(documents.workbook(host,room.getId(),melissaBoard)).thenReturn(Optional.of(pdf("TASK 1: 25/5=5")));
        var context = service.read(host,room,"Explain task 1 for Melissa",
            new KolinChatService.Context("student",melissa.getId(),1));
        assertThat(context).containsEntry("state","text_context_available");
        List<Map<String,Object>> pages = (List<Map<String,Object>>) context.get("relevantPages");
        assertThat(pages).isNotEmpty();
        assertThat(pages.get(0)).containsEntry("source","Мелисса").containsEntry("pageNumber",1);
        // An explicitly numbered question about Melissa must prioritize her
        // task rather than mixing the identically numbered group problem.
        assertThat(pages.toString()).contains("25/5=5").doesNotContain("4+6=10");
        var overview=service.read(host,room,"Какие темы на сегодняшнем уроке?",
            new KolinChatService.Context("group",null,1));
        assertThat(overview.get("relevantPages").toString()).contains("25/5=5","4+6=10");
        assertThat(pages.toString()).doesNotContain(melissa.getId().toString(),teacher.getEmail(),"answers.pdf");
    }

    @SuppressWarnings("unchecked")
    @Test void explainsTaskSevenFromItsActualPdfPageNotPageSevenOrTheFirstPage() throws Exception {
        when(roster.read(room)).thenReturn(List.of());
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(8L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdfPages(
            "TASK 1: Compute 4+6",
            "7 Erklaere warum sqrt(x^2)=x nicht immer gilt.",
            "TASK 9: Berechne sqrt(49)"
        )));
        var context=service.read(host,room,"Объясни задание 7",
            new KolinChatService.Context("group",null,1));
        var task=(Map<String,Object>)context.get("taskReference");
        assertThat(task).containsEntry("state","resolved").containsEntry("requestedNumber",7)
            .containsEntry("pageNumber",2).containsEntry("source","Общая доска");
        assertThat(task.get("taskId")).asString().matches("task-[a-f0-9]{24}");
        assertThat(task.get("statement")).asString().contains("sqrt(x^2)=x");
        var pages=(List<Map<String,Object>>)context.get("relevantPages");
        assertThat(pages.get(0)).containsEntry("pageNumber",2);
        assertThat(pages.get(0).get("exerciseReferences").toString()).contains("number=7")
            .doesNotContain("teacher@test.local");
    }

    @SuppressWarnings("unchecked")
    @Test void explicitlySelectedPupilOverridesSimilarNumbersOnSharedPage() throws Exception {
        rosterAndInk();
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(2L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdf("TASK 7: Group fractions")));
        String personal=PersonalBoard.workbookTargetIdFor(melissa.getId());
        when(documents.workbookVersion(host,room.getId(),personal)).thenReturn(4L);
        when(documents.workbook(host,room.getId(),personal)).thenReturn(Optional.of(pdf("TASK 7: Personal roots")));
        var output=service.read(host,room,"Объясни задание 7 Мелиссы",
            new KolinChatService.Context("group",null,1));
        var task=(Map<String,Object>)output.get("taskReference");
        assertThat(task).containsEntry("state","resolved").containsEntry("source","Мелисса");
        assertThat(task.get("statement")).asString().contains("Personal roots").doesNotContain("Group fractions");
        assertThat(((List<Map<String,Object>>)output.get("relevantPages")).get(0))
            .containsEntry("source","Мелисса");
    }

    @SuppressWarnings("unchecked")
    @Test void ambiguousRepeatedTaskNumbersRequireClarificationRatherThanAnInventedPage() throws Exception {
        when(roster.read(room)).thenReturn(List.of());
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(4L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdfPages(
            "7. Task about fractions",
            "7. Task about quadratic roots"
        )));
        var ambiguous=service.read(host,room,"Объясни задание 7",new KolinChatService.Context("group",null,3));
        var task=(Map<String,Object>)ambiguous.get("taskReference");
        assertThat(task).containsEntry("state","ambiguous").containsEntry("requestedNumber",7);
        assertThat(task).doesNotContainKey("statement");
        assertThat((List<?>)task.get("alternatives")).hasSize(2);
        var current=service.read(host,room,"Объясни задание 7",new KolinChatService.Context("group",null,2));
        assertThat((Map<String,Object>)current.get("taskReference"))
            .containsEntry("state","resolved").containsEntry("pageNumber",2);
    }

    @SuppressWarnings("unchecked")
    @Test void cannotResolveTaskFromAnotherPupilWhenTeacherSelectedDifferentPupil() throws Exception {
        rosterAndInk();
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(0L);
        var sofiaBoard=PersonalBoard.workbookTargetIdFor(sofia.getId());
        when(documents.workbookVersion(host,room.getId(),sofiaBoard)).thenReturn(2L);
        when(documents.workbook(host,room.getId(),sofiaBoard)).thenReturn(Optional.of(pdf("TASK 7: Sofia secret problem")));
        var result=service.read(host,room,"Объясни задание 7",
            new KolinChatService.Context("student",melissa.getId(),1));
        var task=(Map<String,Object>)result.get("taskReference");
        assertThat(task).containsEntry("state","not_found_in_selected_document");
        assertThat(task).doesNotContainKey("statement");
        assertThat(result.get("relevantPages").toString()).doesNotContain("Sofia secret problem");
    }

    @Test void preservesARevisionKeyedCacheAndReloadsAfterPdfReplacement() throws Exception {
        when(roster.read(room)).thenReturn(List.of());
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(5L,5L,5L,6L,6L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(
            Optional.of(pdf("Old lesson task")),Optional.of(pdf("Updated lesson task")));
        var first = service.read(host,room,"task",null);
        var again = service.read(host,room,"task",null);
        var updated = service.read(host,room,"task",null);
        assertThat(first.toString()).contains("Old lesson task");
        assertThat(again.toString()).contains("Old lesson task");
        assertThat(updated.toString()).contains("Updated lesson task").doesNotContain("Old lesson task");
        verify(documents,times(2)).workbook(host,room.getId(),"board-1");
    }

    @Test void replacementDuringReadDoesNotLeakAnOldPdfUnderTheNewVersion() throws Exception {
        when(roster.read(room)).thenReturn(List.of());
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(3L,4L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdf("Stale lesson conditions")));
        var result = service.read(host,room,"Give the problem",null);
        assertThat(result.get("relevantPages").toString()).doesNotContain("Stale lesson conditions");
        assertThat(result.get("catalog").toString()).contains("changed_during_read");
    }

    @Test void neverFetchesFilesOfStudentsOutsideTheServerRoomRoster() throws Exception {
        when(roster.read(room)).thenReturn(List.of(new KolinTaskRoster.Pupil(melissa.getId(),"Мелисса")));
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(0L);
        service.read(host,room,"Show Sofia's private workbook",new KolinChatService.Context("group",null,1));
        verify(documents,never()).workbookVersion(host,room.getId(),PersonalBoard.workbookTargetIdFor(sofia.getId()));
        verify(documents,never()).workbook(host,room.getId(),PersonalBoard.workbookTargetIdFor(sofia.getId()));
    }

    @Test void blankScannedAndMissingFilesNeverPretendToHaveReadableConditions() throws Exception {
        when(roster.read(room)).thenReturn(List.of());
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of());
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(3L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdf("")));
        var result = service.read(host,room,"What are the problems in this scanned PDF?",null);
        assertThat(result).containsEntry("state","image_only_or_empty").containsEntry("selectedPageCount",0);
        assertThat(result.get("limitations").toString()).contains("NOT read");
    }

    @SuppressWarnings("unchecked")
    @Test void savedInkMetadataDoesNotMasqueradeAsRecognizedHandwriting() throws Exception {
        rosterAndInk();
        var ink = OnlineClassAnnotationDocument.create(room,AnnotationTargetType.WHITEBOARD,"board-1",0);
        ink.nextRevision();
        when(annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of(ink));
        when(documents.workbookVersion(host,room.getId(),"board-1")).thenReturn(10L);
        when(documents.workbook(host,room.getId(),"board-1")).thenReturn(Optional.of(pdf("TASK 1: 10 / 2")));
        var output=service.read(host,room,"What is on page 1?",null);
        var pages=(List<Map<String,Object>>)output.get("relevantPages");
        assertThat(pages).hasSize(1);
        assertThat(pages.get(0)).containsEntry("savedHandwritingPresent",true).containsEntry("handwritingRevision",1L);
        assertThat(output).containsEntry("handwritingContentReadable",false);
    }
}
