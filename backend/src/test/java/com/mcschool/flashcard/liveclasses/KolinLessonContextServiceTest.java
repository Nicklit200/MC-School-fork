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
        assertThat(pages.toString()).contains("25/5=5","4+6=10");
        assertThat(pages.toString()).doesNotContain(melissa.getId().toString(),teacher.getEmail(),"answers.pdf");
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
